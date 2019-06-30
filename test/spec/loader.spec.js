const {URL} = require('url');
const test = require('ava');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

function createLoader() {
  const mockFs = {
    existsSync(path) {
      return !(path === '/not-found');
    },
    readFile(...params) {
      const path = params[0];
      const cb = params.pop();
      const err = path === '/not-found' ? new Error('Not Found') : null;
      setImmediate(() => {
        cb(err);
      });
    }
  };

  const fsSpy = sinon.spy(mockFs, 'readFile');

  const mockUrlFetch = function (url) {
    if (url.endsWith('abc')) {
      return Promise.resolve({
        status: 200,
        statusText: 'OK',
        text: () => {
          return Promise.resolve();
        }
      });
    }
    // console.log(`[mockFetch] url=${url}`);
    return Promise.resolve({
      status: 404,
      statusText: 'Not Found'
    });
    };

  const urlSpy = sinon.spy(mockUrlFetch);

  delete require.cache[require.resolve('fs')];
  delete require.cache[require.resolve('node-fetch')];
  delete require.cache[require.resolve('../../fetch')];

  const mockFetch = proxyquire('../../fetch', {
    fs: mockFs,
    'node-fetch': urlSpy
  });

  const Loader = proxyquire('../../loader', {
    './fetch': mockFetch
  });

  return [Loader, fsSpy, urlSpy];
}

test.cb('loader.file', t => {
  const [Loader, fsSpy, urlSpy] = createLoader();
  const loader = new Loader();
  const path = '/existing';
  loader.load(new URL(`file://${path}`), err => {
    t.is(fsSpy.callCount, 1);
    t.is(urlSpy.callCount, 0);
    t.is(err, null);
    t.true(fsSpy.calledWith(path));
    t.end();
  });
});

test.cb('loader.no-file', t => {
  const [Loader, fsSpy, urlSpy] = createLoader();
  const loader = new Loader();
  const path = '/not-found';
  loader.load(new URL(`file://${path}`), err => {
    t.is(fsSpy.callCount, 0);
    t.is(urlSpy.callCount, 0);
    t.not(err, null);
    t.end();
  });
});

test.cb('loader.url', t => {
  const [Loader, fsSpy, urlSpy] = createLoader();
  const loader = new Loader();
  const url = new URL('http://foo.bar/abc');
  loader.load(url, err => {
    t.is(fsSpy.callCount, 0);
    t.is(urlSpy.callCount, 1);
    t.is(err, null);
    t.end();
  });
});

test.cb('loader.no-url', t => {
  const [Loader, fsSpy, urlSpy] = createLoader();
  const loader = new Loader();
  const url = new URL('http://foo.bar/def');
  loader.load(url, err => {
    t.is(fsSpy.callCount, 0);
    t.is(urlSpy.callCount, 1);
    t.not(err, null);
    t.end();
  });
});

test.cb('loader.cache', t => {
  const [Loader, fsSpy] = createLoader();
  const loader = new Loader();
  const path = '/existing';
  loader.load(new URL(`file://${path}`), err => {
    t.is(fsSpy.callCount, 1);
    t.is(err, null);
    loader.load(new URL(`file://${path}`), err => {
      t.is(fsSpy.callCount, 1); // cache should work
      t.is(err, null);
      loader.load(new URL(`file://${path}`), {noCache: true}, err => {
        t.is(fsSpy.callCount, 2); // cache should not work
        t.is(err, null);
        t.end();
      });
    });
  });
});
