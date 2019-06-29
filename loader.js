const debug = require('debug');
const through = require('through2-parallel');
const utils = require('./utils');
const fetch = require('./fetch');
const Cache = require('./cache');

const print = debug('hlx-file-reader');
const MAX_EVENT_LISTENERS = 50;

class Loader {
  constructor(options = {}) {
    const concurrency = options.concurrency || 6;
    this.cache = new Cache();
    this.waitlist = new Set();
    this.stream = through.obj({concurrency}, ({url, options}, enc, cb) => {
      print(`[GET] ${url.href}`);
      fetch(url, options)
      .then(data => {
        if (!options.noCache) {
          this.cache.append(url.href, data);
        }
        this.stream.push({url: url.href, data});
        cb();
      }).catch(err => {
        print(`Error: ${err.stack}`);
        setImmediate(() => this.stream.emit('error', {url: url.href, err}));
        cb();
      });
    });
    this.stream.setMaxListeners(MAX_EVENT_LISTENERS);
  }

  load(...args) {
    const url = args[0];
    const cb = args[args.length - 1];
    const options = args.length > 2 ? args[1] : {};
    print(`Loader.load("${url.href}")`);

    utils.PARAMCHECK(url, cb);
    utils.ASSERT('Loader.load: cb is not a function', typeof cb === 'function');

    if (!options.noCache) {
      const data = this.cache.get(url.href);
      if (data) {
        return process.nextTick(() => {
          cb(null, data);
        });
      }
    }

    const {waitlist, stream} = this;

    if (!waitlist.has(url.href)) {
      stream.write({url, options});
      waitlist.add(url.href);
    }

    function onData(result) {
      if (result.url === url.href) {
        stream.removeListener('data', onData);
        stream.removeListener('error', onError);
        waitlist.delete(url.href);
        cb(null, result.data);
      }
    }

    function onError(result) {
      if (result.url === url.href) {
        stream.removeListener('data', onData);
        stream.removeListener('error', onError);
        waitlist.delete(url.href);
        cb(result.err);
      }
    }

    stream.on('data', onData).on('error', onError);
  }
}

module.exports = Loader;
