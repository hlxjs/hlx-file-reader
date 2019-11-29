const path = require('path');
const {URL} = require('url');
const stream = require('stream');
const crypto = require('crypto');
const debug = require('debug');
const HLS = require('hls-parser');
const Loader = require('./loader');
const {THROW, tryCatch, getUrlType, masterPlaylistTimeout} = require('./utils');

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
    for (const variant of variants) {
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
    this.initialUri = location;
    options.rootPath = options.rootPath || '/';
    this.options = options;
    this.masterPlaylists = {};
    this.mediaPlaylists = {};
    this.counter = 0;
    this.rawResponseMode = Boolean(options.rawResponse);
    this.pendingList = new Map();
  }

  _INCREMENT() {
    this.counter++;
  }

  _DECREMENT() {
    this.counter--;
    this._resetIfConsumed();
  }

  get consumed() {
    return this.state === 'ended' && this.pendingList.size === 0 && this.counter === 0;
  }

  _resetIfConsumed() {
    if (this.consumed) {
      this.state = 'close';
      setImmediate(() => {
        print('Cancel all pending events');
        this._cancelAll();
        this.masterPlaylists = {};
        this.mediaPlaylists = {};
        this.push(null);
      });
    }
  }

  _schedule(key, func, timeout) {
    if (this.state === 'ended' || this.pendingList.has(key)) {
      return false;
    }
    const id = setTimeout(() => {
      this.pendingList.delete(key);
      func();
      this._resetIfConsumed();
    }, timeout);
    this.pendingList.set(key, id);
    return true;
  }

  _cancel(key) {
    const timerId = this.pendingList.get(key);
    if (timerId) {
      clearTimeout(timerId);
      this.pendingList.delete(key);
      return true;
    }
    return false;
  }

  _cancelAll() {
    for (const timerId of this.pendingList.values()) {
      clearTimeout(timerId);
    }
    this.pendingList.clear();
  }

  _checkIfAllEnd() {
    for (const playlist of Object.values(this.mediaPlaylists)) {
      if (playlist.playlistType === 'VOD' || playlist.endlist) {
        continue;
      }
      return false;
    }
    return true;
  }

  _resolveUri(uri, documentUri) {
    const type = getUrlType(uri);

    if (type === 'absolute') {
      return new URL(uri);
    }

    const documentUrl = tryCatch(
      () => new URL(documentUri),
      () => null
    );

    const {rootPath} = this.options;

    if (type === 'scheme-relative') {
      if (documentUrl) {
        return new URL(`${documentUrl.protocol}${uri}`);
      }
      return new URL(`file:${rootPath}${uri}`);
    }

    if (type === 'path-absolute') {
      if (documentUrl && documentUrl.protocol !== 'file:') {
        return new URL(uri, documentUrl.href);
      }
    }

    if (type === 'path-relative') {
      if (documentUrl) {
        return new URL(uri, documentUrl.href);
      }
    }

    const fullPath = path.join(rootPath, uri);
    return new URL(`file://${fullPath}`);
  }

  _needToReload(masterPlaylist) {
    const {mediaPlaylists} = this;
    const {variants} = masterPlaylist;
    let playlist;
    for (const variant of variants) {
      playlist = mediaPlaylists[this._resolveUri(variant.uri, masterPlaylist.uri)];
      if (!playlist || (playlist.playlistType !== 'VOD' && !playlist.endlist)) {
        return true;
      }
      ['audio', 'video', 'subtitles', 'closedCaptions'].forEach(prop => {
        const renditions = variant[prop];
        for (const rendition of renditions) {
          playlist = mediaPlaylists[this._resolveUri(rendition.uri, masterPlaylist.uri)];
          if (!playlist || (playlist.playlistType !== 'VOD' && !playlist.endlist)) {
            return true;
          }
        }
      });
    }
    return false;
  }

  _deferIfUnchanged(uri, documentUri, hash) {
    const {masterPlaylists, mediaPlaylists} = this;
    const playlistUri = this._resolveUri(uri, documentUri);
    const playlist = masterPlaylists[playlistUri] || mediaPlaylists[playlistUri];
    if (playlist && playlist.hash === hash) {
      const waitSeconds = playlist.isMasterPlaylist ? masterPlaylistTimeout : playlist.targetDuration * 0.5;
      print(`No update. Wait for a period of one-half the target duration before retrying (${waitSeconds}) sec`);
      this._schedule(playlistUri, () => {
        this._loadPlaylist(uri, documentUri);
      }, waitSeconds * 1000);
      return true;
    }
    return false;
  }

  _updateMasterPlaylist(playlist) {
    print(`_updateMasterPlaylist(uri="${playlist.uri}")`);
    this.updateVariant(playlist);
    this.masterPlaylists[playlist.uri] = playlist;
    if (this._needToReload(playlist)) {
      print(`Wait for ${masterPlaylistTimeout} sec`);
      this._schedule(playlist.uri, () => {
        this._loadPlaylist(playlist.uri, playlist.parentUri);
      }, masterPlaylistTimeout * 1000);
    }
  }

  updateVariant(playlist) {
    if (this.state !== 'reading') {
      THROW(new Error('the state should be "reading"'));
    }
    const {masterPlaylists} = this;
    const oldPlaylist = masterPlaylists[playlist.uri];
    const oldVariants = oldPlaylist ? oldPlaylist.variants : [];
    const {variants} = playlist;

    // Get feedback from the client
    let variantsToLoad = [...new Array(variants.length).keys()];
    this._emit('variants', variants, indices => {
      variantsToLoad = indices;
    });

    // Load playlists
    for (const index of variantsToLoad) {
      const variant = variants[index];
      const oldVariantIndex = oldVariants.findIndex(elem => {
        if (elem.uri === variant.uri) {
          return true;
        }
        return false;
      });
      const oldVariant = oldVariantIndex === -1 ? null : oldVariants[oldVariantIndex];
      if (oldVariant) {
        oldVariants.splice(oldVariantIndex, 1);
      } else {
        this._loadPlaylist(variant.uri, playlist.uri);
        this._updateRendition(playlist, variant);
      }
    }

    // Delete references to the variants removed from the master playlist
    const {mediaPlaylists} = this;
    for (const varint of oldVariants) {
      delete mediaPlaylists[this._resolveUri(varint.uri, playlist.uri)];
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
          const rendition = renditions[index];
          if (rendition) {
            this._loadPlaylist(rendition.uri, playlist.uri);
          }
        }
      }
    });
  }

  _updateMediaPlaylist(playlist) {
    print(`_updateMediaPlaylist(uri="${playlist.uri}")`);
    const {mediaPlaylists} = this;
    const oldPlaylist = mediaPlaylists[playlist.uri];
    const oldSegments = oldPlaylist ? oldPlaylist.segments : [];
    const {segments} = playlist;
    for (const segment of segments) {
      const oldSegment = oldSegments.find(elem => {
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
      segment.parentUri = playlist.uri;
    }

    mediaPlaylists[playlist.uri] = playlist;

    if (playlist.playlistType === 'VOD' || playlist.endlist) {
      this._cancel(playlist.uri);
      if (this._checkIfAllEnd()) {
        print('State is set to "ended"');
        this.state = 'ended';
      }
    } else {
      print(`Wait for at least the target duration before attempting to reload the Playlist file again (${playlist.targetDuration}) sec`);
      this._schedule(playlist.uri, () => {
        this._loadPlaylist(playlist.uri, playlist.parentUri);
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

  _loadPlaylist(uri, parentUri = '') {
    print(`_loadPlaylist("${uri}", ${parentUri})`);

    this._INCREMENT();

    const url = this._resolveUri(uri, parentUri);

    this.loader.load(url, {noCache: true}, (err, result) => {
      this._DECREMENT();
      if (err) {
        return this._emit('error', err);
      }
      const hash = digest(result.data);
      if (this._deferIfUnchanged(uri, parentUri, hash)) {
        // The file is not changed
        return;
      }
      const playlist = HLS.parse(result.data);
      playlist.source = result.data;
      playlist.uri = url.href;
      playlist.parentUri = parentUri;
      playlist.hash = hash;
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
    if (this.options.playlistOnly) {
      return print('\tplaylistOnly. exit');
    }
    this._INCREMENT();
    this.loader.load(this._resolveUri(segment.uri, playlist.uri), {
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
      this.loader.load(this._resolveUri(sessionData.uri, playlist.uri), (err, result) => {
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
    this.loader.load(this._resolveUri(key.uri, playlist.uri), {readAsBuffer: true}, (err, result) => {
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
    this.loader.load(this._resolveUri(map.uri, playlist.uri), {readAsBuffer: true}, (err, result) => {
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
      this._loadPlaylist(this.initialUri);
    }
  }
}

module.exports = ReadStream;
