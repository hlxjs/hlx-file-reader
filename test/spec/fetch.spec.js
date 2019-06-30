const {Readable} = require('stream');
const {URL} = require('url');
const test = require('ava');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

function createStream(fn) {
  const readable = new Readable({objectMode: true});
  readable._read = fn;
  return readable;
}

const results = {
  '/existing': {
    err: null,
    data: Buffer.alloc(10)
  },
  '/not-found': {
    err: new Error('Not Found'),
    data: null
  }
};

function createFetch() {
  const mockFs = {
    existsSync(path) {
      return !(path === '/not-found');
    },
    createReadStream(path) {
      const {err, data} = results[path];
      if (err) {
        return createStream(() => {
          this.emit('error', err);
        });
      }
      return createStream(() => {
        this.push(data);
        this.push(null);
      });
    },
    readFile(...params) {
      const path = params[0];
      const cb = params.pop();
      const {err, data} = results[path];
      setImmediate(() => {
        cb(err, data);
      });
    }
  };

  const readFileSpy = sinon.spy(mockFs, 'readFile');
  const createReadStreamSpy = sinon.spy(mockFs, 'createReadStream');

  const mockUrlFetch = function (url) {
    if (url.endsWith('abc')) {
      return Promise.resolve({
        status: 200,
        statusText: 'OK',
        body: createStream(() => {
          this.push(Buffer.alloc(10));
          this.push(null);
        }),
        text() {
          return Promise.resolve('abc');
        },
        buffer() {
          return Promise.resolve(Buffer.alloc(10));
        }
      });
    }
    // console.log(`[mockFetch] url=${url}`);
    return Promise.resolve({
      status: 404,
      statusText: 'Not Found'
    });
  };

  const fetchSpy = sinon.spy(mockUrlFetch);

  delete require.cache[require.resolve('fs')];
  delete require.cache[require.resolve('node-fetch')];
  delete require.cache[require.resolve('../../fetch')];

  const fetch = proxyquire('../../fetch', {
    fs: mockFs,
    'node-fetch': fetchSpy
  });

  return [fetch, readFileSpy, fetchSpy, createReadStreamSpy];
}

test.cb('fetch.file', t => {
  const [fetch, readFileSpy, fetchSpy] = createFetch();
  const path = '/existing';
  fetch(new URL(`file://${path}`))
  .then(({data}) => {
    t.is(readFileSpy.callCount, 1);
    t.is(fetchSpy.callCount, 0);
    t.truthy(data);
    t.true(readFileSpy.calledWith(path));
    t.end();
  });
});

test.cb('fetch.no-file', t => {
  const [fetch, readFileSpy, fetchSpy] = createFetch();
  const path = '/not-found';
  fetch(new URL(`file://${path}`))
  .catch(err => {
    t.is(readFileSpy.callCount, 0);
    t.is(fetchSpy.callCount, 0);
    t.truthy(err);
    t.end();
  });
});

test.cb('fetch.url', t => {
  const [fetch, readFileSpy, fetchSpy] = createFetch();
  fetch(new URL('http://foo.bar/abc'))
  .then(({data}) => {
    t.is(readFileSpy.callCount, 0);
    t.is(fetchSpy.callCount, 1);
    t.truthy(data);
    t.end();
  });
});

test.cb('fetch.no-url', t => {
  const [fetch, readFileSpy, fetchSpy] = createFetch();
  fetch(new URL('http://foo.bar/def'))
  .catch(err => {
    t.is(readFileSpy.callCount, 0);
    t.is(fetchSpy.callCount, 1);
    t.truthy(err);
    t.end();
  });
});

test.cb('fetch.readAsBuffer.file', t => {
  const [fetch, readFileSpy] = createFetch();
  const path = '/existing';
  fetch(new URL(`file://${path}`))
  .then(() => {
    t.is(readFileSpy.callCount, 1);
    t.true(readFileSpy.getCall(0).calledWith(path, {encoding: 'utf8'}));
    fetch(new URL(`file://${path}`), {readAsBuffer: true})
    .then(() => {
      t.is(readFileSpy.callCount, 2);
      t.true(readFileSpy.getCall(1).calledWith(path, {encoding: null}));
      t.end();
    });
  });
});

test.cb('fetch.readAsBuffer.url', t => {
  const [fetch, readFileSpy, fetchSpy] = createFetch();
  const url = new URL('http://foo.bar/abc');
  fetch(url)
  .then(({data}) => {
    t.is(fetchSpy.callCount, 1);
    t.is(readFileSpy.callCount, 0);
    t.is(typeof data, 'string');
    fetch(url, {readAsBuffer: true})
    .then(({data}) => {
      t.is(fetchSpy.callCount, 2);
      t.is(readFileSpy.callCount, 0);
      t.true(Buffer.isBuffer(data));
      t.end();
    });
  });
});

test.cb('fetch.rawResponse.file', t => {
  const [fetch, readFileSpy, fetchSpy, createReadStreamSpy] = createFetch();
  const path = '/existing';
  fetch(new URL(`file://${path}`))
  .then(({data}) => {
    t.is(readFileSpy.callCount, 1);
    t.is(fetchSpy.callCount, 0);
    t.is(createReadStreamSpy.callCount, 0);
    t.true(Buffer.isBuffer(data));
    fetch(new URL(`file://${path}`), {rawResponse: true})
    .then(({data}) => {
      t.is(createReadStreamSpy.callCount, 1);
      t.true(data instanceof Readable);
      t.end();
    });
  });
});

test.cb('fetch.rawResponse.url', t => {
  const [fetch, readFileSpy, fetchSpy] = createFetch();
  const url = new URL('http://foo.bar/abc');
  fetch(url)
  .then(({data}) => {
    t.is(readFileSpy.callCount, 0);
    t.is(fetchSpy.callCount, 1);
    t.is(typeof data, 'string');
    fetch(url, {rawResponse: true})
    .then(({data}) => {
      t.is(fetchSpy.callCount, 2);
      t.true(data instanceof Readable);
      t.end();
    });
  });
});
