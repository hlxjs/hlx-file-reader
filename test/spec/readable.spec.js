const path = require('path');
const {Readable} = require('stream');
const test = require('ava');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

function getDataAndType(url) {
  const type = 'application/vnd.apple.mpegurl';
  if (url.endsWith('master.m3u8')) {
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
  if (url.endsWith('.m3u8')) {
    return [`
      #EXTM3U
      #EXT-X-VERSION:3
      #EXT-X-TARGETDURATION:10
      #EXTINF:9.009,
      http://media.example.com/${buildFileBase(url)}-01.ts
      #EXTINF:9.009,
      http://media.example.com/${buildFileBase(url)}-02.ts
      #EXTINF:3.003,
      http://media.example.com/${buildFileBase(url)}-03.ts
      #EXT-X-ENDLIST
    `, type];
  }
  return [Buffer.alloc(10), 'video/mp2t'];
}

function buildFileBase(playlistUrl) {
  const params = playlistUrl.split('/');
  const subdir = params[params.length - 2];
  const fileBase = params[params.length - 1].replace('.m3u8', '');
  return `${subdir}/${fileBase}`;
}

const cwd = process.cwd();

const pathList = [
  path.join(cwd, '/manifest/master.m3u8'),
  path.join(cwd, '/manifest/low/main.m3u8'),
  path.join(cwd, '/manifest/low/sub1.m3u8'),
  path.join(cwd, '/manifest/low/sub2.m3u8'),
  path.join(cwd, '/manifest/mid/main.m3u8'),
  path.join(cwd, '/manifest/mid/sub1.m3u8'),
  path.join(cwd, '/manifest/mid/sub2.m3u8'),
  path.join(cwd, '/manifest/high/main.m3u8'),
  path.join(cwd, '/manifest/high/sub1.m3u8'),
  path.join(cwd, '/manifest/high/sub2.m3u8')
];

const urlList = [
  'http://media.example.com/low/main-01.ts',
  'http://media.example.com/low/main-02.ts',
  'http://media.example.com/low/main-03.ts',
  'http://media.example.com/low/sub1-01.ts',
  'http://media.example.com/low/sub1-02.ts',
  'http://media.example.com/low/sub1-03.ts',
  'http://media.example.com/low/sub2-01.ts',
  'http://media.example.com/low/sub2-02.ts',
  'http://media.example.com/low/sub2-03.ts',
  'http://media.example.com/mid/main-01.ts',
  'http://media.example.com/mid/main-02.ts',
  'http://media.example.com/mid/main-03.ts',
  'http://media.example.com/mid/sub1-01.ts',
  'http://media.example.com/mid/sub1-02.ts',
  'http://media.example.com/mid/sub1-03.ts',
  'http://media.example.com/mid/sub2-01.ts',
  'http://media.example.com/mid/sub2-02.ts',
  'http://media.example.com/mid/sub2-03.ts',
  'http://media.example.com/high/main-01.ts',
  'http://media.example.com/high/main-02.ts',
  'http://media.example.com/high/main-03.ts',
  'http://media.example.com/high/sub1-01.ts',
  'http://media.example.com/high/sub1-02.ts',
  'http://media.example.com/high/sub1-03.ts',
  'http://media.example.com/high/sub2-01.ts',
  'http://media.example.com/high/sub2-02.ts',
  'http://media.example.com/high/sub2-03.ts'
];

function createStream(fn) {
  const readable = new Readable({objectMode: true});
  readable._read = fn;
  return readable;
}

/*
test('createReadStream', t => {
  t.truthy(createReadStream('url', {foo: 'bar'}));
  t.truthy(createReadStream('url'));
});
*/

test.cb('createReadStream.renditions', t => {
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
      const [data] = getDataAndType(path);
      t.true(pathList.includes(path));
      setImmediate(() => {
        cb(null, data);
      });
    }
  };

  const mockFetch = {
    fetch(url) {
      // console.log(`[mockFetch] url=${url}, params=${params}`);
      t.true(urlList.includes(url));
      const [data, type] = getDataAndType(url);
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
  const mockReadable = proxyquire('../../readable', {'./loader': mockLoader});
  const {createReadStream} = proxyquire('../..', {'./readable': mockReadable});

  const obj = {
    onVariants() {
      // Nop
    },
    onRenditions() {
      // Nop
    },
    onData() {
      // Nop
    },
    onEnd() {
      process.nextTick(checkResult);
    }
  };

  const spyVariants = sinon.spy(obj, 'onVariants');
  const spyRenditions = sinon.spy(obj, 'onRenditions');
  const spyData = sinon.spy(obj, 'onData');
  const spyEnd = sinon.spy(obj, 'onEnd');

  createReadStream('./manifest/master.m3u8', {rootPath: cwd})
  .on('variants', obj.onVariants)
  .on('renditions', obj.onRenditions)
  .on('data', obj.onData)
  .on('end', obj.onEnd);

  function checkResult() {
    t.is(spyVariants.callCount, 1);
    t.is(spyRenditions.callCount, 3);
    t.is(spyData.callCount, 1 + 9 + 27);
    t.true(spyEnd.calledOnce);
    t.end();
  }
});
