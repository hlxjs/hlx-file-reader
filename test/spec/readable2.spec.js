const {Readable, Transform} = require('stream');
const test = require('ava');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const rewrite = require('../helper/rewriter');

function getDataAndType(url, end) {
  const type = 'application/vnd.apple.mpegurl';
  if (url.endsWith('master.m3u8')) {
    if (end) {
      return [`
        #EXTM3U
        #EXT-X-STREAM-INF:BANDWIDTH=1280000,CODECS="avc1.640029,mp4a.40.2",VIDEO="low"
        /manifest/low/main.m3u8
        #EXT-X-STREAM-INF:BANDWIDTH=2560000,CODECS="avc1.640029,mp4a.40.2",VIDEO="mid"
        /manifest/mid/main.m3u8
        #EXT-X-STREAM-INF:BANDWIDTH=7680000,CODECS="avc1.640029,mp4a.40.2",VIDEO="high"
        /manifest/high/main.m3u8

        #EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="low",NAME="Main",DEFAULT=YES,URI="/manifest/low/main.m3u8"
        #EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="low",NAME="Sub-1",DEFAULT=NO,URI="/manifest/low/sub1.m3u8"
        #EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="low",NAME="Sub-2",DEFAULT=NO,URI="/manifest/low/sub2.m3u8"

        #EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="mid",NAME="Main",DEFAULT=YES,URI="/manifest/mid/main.m3u8"
        #EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="mid",NAME="Sub-1",DEFAULT=NO,URI="/manifest/mid/sub1.m3u8"
        #EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="mid",NAME="Sub-2",DEFAULT=NO,URI="/manifest/mid/sub2.m3u8"

        #EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="high",NAME="Main",DEFAULT=YES,URI="/manifest/high/main.m3u8"
        #EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="high",NAME="Sub-1",DEFAULT=NO,URI="/manifest/high/sub1.m3u8"
        #EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="high",NAME="Sub-2",DEFAULT=NO,URI="/manifest/high/sub2.m3u8"
      `, type];
    }
    return [`
      #EXTM3U
      #EXT-X-STREAM-INF:BANDWIDTH=1280000,CODECS="avc1.640029,mp4a.40.2",VIDEO="low"
      /manifest/low/main.m3u8
      #EXT-X-STREAM-INF:BANDWIDTH=2560000,CODECS="avc1.640029,mp4a.40.2",VIDEO="mid"
      /manifest/mid/main.m3u8

      #EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="low",NAME="Main",DEFAULT=YES,URI="/manifest/low/main.m3u8"
      #EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="low",NAME="Sub-1",DEFAULT=NO,URI="/manifest/low/sub1.m3u8"
      #EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="low",NAME="Sub-2",DEFAULT=NO,URI="/manifest/low/sub2.m3u8"

      #EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="mid",NAME="Main",DEFAULT=YES,URI="/manifest/mid/main.m3u8"
      #EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="mid",NAME="Sub-1",DEFAULT=NO,URI="/manifest/mid/sub1.m3u8"
      #EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="mid",NAME="Sub-2",DEFAULT=NO,URI="/manifest/mid/sub2.m3u8"
    `, type];
  }
  if (url.endsWith('.m3u8')) {
    return [buildMediaPlaylist(url, end), type];
  }
  return [Buffer.alloc(10), 'video/mp2t'];
}

function buildMediaPlaylist(url, end) {
  return `
    #EXTM3U
    #EXT-X-VERSION:3
    #EXT-X-TARGETDURATION:2
    #EXTINF:2.009,
    http://media.example.com/${buildFileBase(url)}-01.ts
    #EXTINF:2.009,
    http://media.example.com/${buildFileBase(url)}-02.ts
    #EXTINF:1.003,
    http://media.example.com/${buildFileBase(url)}-03.ts
    ${end ? '#EXT-X-ENDLIST' : ''}
  `;
}

function buildFileBase(playlistUrl) {
  const params = playlistUrl.split('/');
  const subdir = params[params.length - 2];
  const fileBase = params[params.length - 1].replace('.m3u8', '');
  return `${subdir}/${fileBase}`;
}

function createStream(fn) {
  const readable = new Readable({objectMode: true});
  readable._read = fn;
  return readable;
}

const endFlag = {};

test.cb('createReadStream.variant-increased', t => {
  const mockFs = {
    existsSync() {
      return true;
    },
    createReadStream() {
      return createStream(() => {
        this.push(Buffer.alloc(10));
        this.push(null);
      });
    },
    readFile(...params) {
      const path = params[0];
      const cb = params.pop();
      const [data] = getDataAndType(path, endFlag[path]);
      endFlag[path] = true;
      setImmediate(() => {
        cb(null, data);
      });
    }
  };

  const mockFetch = {
    fetch(url) {
      // console.log(`[mockFetch] url=${url}, params=${params}`);
      const [data, type] = getDataAndType(url, endFlag[url]);
      endFlag[url] = true;
      return Promise.resolve({
        status: 200,
        statusText: 'OK',
        headers: {
          get(h) {
            const header = h.toLowerCase();
            if (header === 'content-type') {
              return type;
            }
          }
        },
        text() {
          return Promise.resolve(data);
        },
        buffer() {
          return Promise.resolve(data);
        }
      });
    }
  };

  const mockFetchLib = proxyquire('../../fetch', {fs: mockFs, 'node-fetch': mockFetch.fetch});
  const mockLoader = proxyquire('../../loader', {'./fetch': mockFetchLib});
  const mockUtils = require('../../utils');
  mockUtils.masterPlaylistTimeout = 0.5;
  const mockReadable = proxyquire('../../readable', {'./loader': mockLoader, './utils': mockUtils});
  const {createReadStream} = proxyquire('../..', {'./readable': mockReadable});

  const obj = {
    onData() {
      // Nop
    },
    onEnd() {
      process.nextTick(checkResult);
    }
  };

  class Modifier extends Transform {
    constructor() {
      super({objectMode: true});
    }

    _transform(data, _, cb) {
      rewrite(data);
      cb(null, data);
    }
  }

  const spyData = sinon.spy(obj, 'onData');
  const spyEnd = sinon.spy(obj, 'onEnd');

  createReadStream('./manifest/master.m3u8')
  .pipe(new Modifier())
  .on('data', obj.onData)
  .on('end', obj.onEnd);

  function checkResult() {
    t.is(spyData.callCount, 2 + (6 + 3 + 9) + 27);
    t.true(spyEnd.calledOnce);
    t.end();
  }
});
