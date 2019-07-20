const stream = require('stream');
const crypto = require('crypto');
const debug = require('debug');
const HLS = require('hls-parser');
const Loader = require('./loader');
const {THROW, tryCatch, resolveUrl} = require('./utils');

const print = debug('hlx-file-reader');

function digest(str) {
  const md5 = crypto.createHash('md5');
  md5.update(str, 'utf8');
  return md5.digest('hex');
}

function trimData(data, byterange) {
  if (byterange) {
    const offset = byterange.offset || 0;
    const length = byterange.length || data.length - offset;
    return data.slice(offset, offset + length);
  }
  return data;
}

function clone(data) {
  if (!data) {
    return data;
  }
  return Object.assign({}, data);
}

function cloneList(data, prop) {
  data[prop] = [...(data[prop])];
  const list = data[prop];
  for (let i = 0; i < list.length; i++) {
    list[i] = clone(list[i]);
  }
}

function cloneData(data) {
  if (data.type === 'segment') {
    return data; // No need to clone
  }
  if (data.isMasterPlaylist) {
    const masterPlaylist = clone(data);
    // Clone variants
    ['variants', 'sessionDataList', 'sessionKeyList'].forEach(prop => cloneList(masterPlaylist, prop));
    const {variants} = masterPlaylist;
    for (const v of variants) {
      const variant = clone(v);
      // Clone renditions
      ['audio', 'video', 'subtitles', 'closedCaptions'].forEach(prop => cloneList(variant, prop));
    }
    return masterPlaylist;
  }
  const mediaPlaylist = clone(data);
  cloneList(mediaPlaylist, 'segments');
  return mediaPlaylist;
}

class ReadStream extends stream.Readable {
  constructor(location, options) {
    super({objectMode: true});
    this.loader = new Loader(options);
    this.state = 'initialized';
    options.rootPath = options.rootPath || process.cwd();
    this.url = resolveUrl(options, location);
    this.options = options;
    this.masterPlaylist = null;
    this.mediaPlaylists = [];
    this.counter = 0;
    this.rawResponseMode = Boolean(options.rawResponse);
    this.pendingList = new Set();
  }

  _INCREMENT() {
    this.counter++;
  }

  _DECREMENT() {
    this.counter--;
    this._checkIfConsumed();
  }

  get consumed() {
    return this.state === 'ended' && this.pendingList.size === 0 && this.counter === 0;
  }

  _checkIfConsumed() {
    if (this.consumed) {
      this.state = 'close';
      setImmediate(() => {
        this._cancelAll();
        this.masterPlaylist = null;
        this.mediaPlaylists = [];
        this.push(null);
      });
    }
  }

  _scedule(func, timeout) {
    if (this.state === 'ended') {
      return false;
    }
    const id = setTimeout(() => {
      this.pendingList.delete(id);
      func();
      this._checkIfConsumed();
    }, timeout);
    this.pendingList.add(id);
    return true;
  }

  _cancelAll() {
    for (const timerId of this.pendingList) {
      clearTimeout(timerId);
    }
    this.pendingList.clear();
  }

  _checkIfAllEnd() {
    return this.mediaPlaylists.every(playlist => {
      return playlist.playlistType === 'VOD' || playlist.endlist;
    });
  }

  _deferIfUnchanged(url, hash) {
    const {mediaPlaylists} = this;
    if (mediaPlaylists.length === 0) {
      return false;
    }
    for (const playlist of mediaPlaylists) {
      const waitSeconds = playlist.targetDuration * 1.5;
      if (playlist.playlistType !== 'VOD' && playlist.hash === hash) {
        print(`No update. Wait for a period of one-half the target duration before retrying (${waitSeconds}) sec`);
        this._scedule(() => {
          this._loadPlaylist(url);
        }, waitSeconds * 1000);
        return true;
      }
    }
    return false;
  }

  _updateMasterPlaylist(playlist) {
    this.masterPlaylist = playlist;
    this.mediaPlaylists = [];
    this.updateVariant();
  }

  updateVariant() {
    if (this.state !== 'reading') {
      THROW(new Error('the state should be "reading"'));
    }
    const playlist = this.masterPlaylist;
    const {variants} = playlist;
    let variantsToLoad = [...new Array(variants.length).keys()];
    this._emit('variants', variants, indices => {
      // Get feedback from the client synchronously
      variantsToLoad = indices;
    });
    for (const index of variantsToLoad) {
      const variant = variants[index];
      this._loadPlaylist(resolveUrl(this.options, this.url, variant.uri));
      this._updateRendition(playlist, variant);
    }
  }

  _updateRendition(playlist, variant) {
    ['audio', 'video', 'subtitles', 'closedCaptions'].forEach(type => {
      const renditions = variant[type];
      if (renditions.length > 0) {
        let renditionsToLoad = [...new Array(renditions.length).keys()];
        this._emit('renditions', renditions, indices => {
          // Get feedback from the client synchronously
          renditionsToLoad = indices;
        });
        for (const index of renditionsToLoad) {
          const url = renditions[index].uri;
          if (url) {
            this._loadPlaylist(resolveUrl(this.options, this.url, url));
          }
        }
      }
    });
  }

  _updateMediaPlaylist(playlist) {
    print(`_updateMediaPlaylist(uri="${playlist.uri}")`);
    const {mediaPlaylists} = this;
    const oldPlaylistIndex = mediaPlaylists.findIndex(elem => {
      if (elem.uri === playlist.uri) {
        return true;
      }
      return false;
    });

    const oldPlaylist = oldPlaylistIndex === -1 ? null : mediaPlaylists[oldPlaylistIndex];
    const newSegments = playlist.segments;
    for (const segment of newSegments) {
      if (oldPlaylist) {
        const oldSegment = oldPlaylist.segments.find(elem => {
          if (elem.uri === segment.uri) {
            return true;
          }
          return false;
        });
        if (oldSegment) {
          segment.data = oldSegment.data;
          segment.key = oldSegment.key;
          segment.map = oldSegment.map;
        } else {
          this._loadSegment(playlist, segment);
        }
      } else {
        this._loadSegment(playlist, segment);
      }
    }

    if (oldPlaylist) {
      mediaPlaylists[oldPlaylistIndex] = playlist;
    } else {
      mediaPlaylists.push(playlist);
    }

    if (playlist.playlistType === 'VOD' || playlist.endlist) {
      if (this._checkIfAllEnd()) {
        print('State is set to "ended"');
        this.state = 'ended';
      }
    } else {
      print(`Wait for at least the target duration before attempting to reload the Playlist file again (${playlist.targetDuration}) sec`);
      this._scedule(() => {
        this._loadPlaylist(resolveUrl(this.options, this.url, playlist.uri));
      }, playlist.targetDuration * 1000);
    }
  }

  _emitPlaylistEvent(playlist) {
    if (!playlist.isMasterPlaylist) {
      return this._emit('data', playlist);
    }
    for (const sessionData of playlist.sessionDataList) {
      if (!sessionData.value && !sessionData.data) {
        return;
      }
    }
    for (const sessionKey of playlist.sessionKeyList) {
      if (!sessionKey.data) {
        return;
      }
    }
    this._emit('data', playlist);
  }

  _loadPlaylist(url) {
    print(`_loadPlaylist("${url}")`);
    this._INCREMENT();
    this.loader.load(url, {noCache: true}, (err, result) => {
      this._DECREMENT();
      if (err) {
        return this._emit('error', err);
      }
      const hash = digest(result.data);
      if (this._deferIfUnchanged(url, hash)) {
        // The file is not changed
        return;
      }
      const playlist = HLS.parse(result.data);
      playlist.source = result.data;
      playlist.uri = url.href;
      if (playlist.isMasterPlaylist) {
        // Master Playlist
        this._emitPlaylistEvent(playlist);
        if (playlist.sessionDataList.length > 0) {
          this._loadSessionData(playlist, () => {
            this._emitPlaylistEvent(playlist);
          });
        }
        if (playlist.sessionKeyList.length > 0) {
          this._loadSessionKey(playlist, () => {
            this._emitPlaylistEvent(playlist);
          });
        }
        this._updateMasterPlaylist(playlist);
      } else {
        // Media Playlist
        playlist.hash = hash;
        this._emitPlaylistEvent(playlist);
        this._updateMediaPlaylist(playlist);
      }
    });
  }

  _emitDataEvent(segment) {
    if (!segment.data) {
      return;
    }
    if (segment.key && !segment.key.data) {
      return;
    }
    if (segment.map && !segment.map.data) {
      return;
    }
    this._emit('data', segment);
  }

  _loadSegment(playlist, segment) {
    print(`_loadSegment("${segment.uri}")`);
    this._INCREMENT();
    this.loader.load(resolveUrl(this.options, this.url, playlist.uri, segment.uri), {
          readAsBuffer: true,
          rawResponse: this.rawResponseMode
        }, (err, result) => {
      this._DECREMENT();
      if (err) {
        return this._emit('error', err);
      }
      if (this.rawResponseMode) {
        segment.data = result.data;
      } else {
        segment.data = trimData(result.data, segment.byterange);
      }
      segment.mimeType = result.mimeType;
      this._emitDataEvent(segment);
    });
    if (segment.key) {
      this._loadKey(playlist, segment.key, () => {
        this._emitDataEvent(segment);
      });
    }
    if (segment.map) {
      this._loadMap(playlist, segment.map, () => {
        this._emitDataEvent(segment);
      });
    }
  }

  _loadSessionData(playlist, cb) {
    const list = playlist.sessionDataList;
    for (const sessionData of list) {
      if (sessionData.value || !sessionData.url) {
        continue;
      }
      this._INCREMENT();
      this.loader.load(resolveUrl(this.options, this.url, playlist.uri, sessionData.uri), (err, result) => {
        this._DECREMENT();
        if (err) {
          return this._emit('error', err);
        }
        sessionData.data = tryCatch(
          () => {
            return JSON.parse(result.data);
          },
          err => {
            print(`The session data MUST be formatted as JSON. ${err.stack}`);
          }
        );
        cb();
      });
    }
  }

  _loadSessionKey(playlist, cb) {
    const list = playlist.sessionKeyList;
    for (const key of list) {
      this._loadKey(playlist, key, cb);
    }
  }

  _loadKey(playlist, key, cb) {
    this._INCREMENT();
    this.loader.load(resolveUrl(this.options, this.url, playlist.uri, key.uri), {readAsBuffer: true}, (err, result) => {
      this._DECREMENT();
      if (err) {
        return this._emit('error', err);
      }
      key.data = result.data;
      cb();
    });
  }

  _loadMap(playlist, map, cb) {
    this._INCREMENT();
    this.loader.load(resolveUrl(this.options, this.url, playlist.uri, map.uri), {readAsBuffer: true}, (err, result) => {
      this._DECREMENT();
      if (err) {
        return this._emit('error', err);
      }
      map.data = trimData(result.data, map.byterange);
      map.mimeType = result.mimeType;
      cb();
    });
  }

  _emit(...params) {
    if (params[0] === 'data') {
      this.push(cloneData(params[1])); // TODO: stop loading segments when this.push() returns false
    } else {
      this.emit(...params);
    }
  }

  _read() {
    if (this.state === 'initialized') {
      this.state = 'reading';
      this._loadPlaylist(this.url);
    }
  }
}

module.exports = ReadStream;
