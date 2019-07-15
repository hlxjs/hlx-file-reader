[![Build Status](https://travis-ci.org/hlxjs/hlx-file-reader.svg?branch=master)](https://travis-ci.org/hlxjs/hlx-file-reader)
[![Coverage Status](https://coveralls.io/repos/github/hlxjs/hlx-file-reader/badge.svg?branch=master)](https://coveralls.io/github/hlxjs/hlx-file-reader?branch=master)
[![Dependency Status](https://david-dm.org/hlxjs/hlx-file-reader.svg)](https://david-dm.org/hlxjs/hlx-file-reader)
[![Development Dependency Status](https://david-dm.org/hlxjs/hlx-file-reader/dev-status.svg)](https://david-dm.org/hlxjs/hlx-file-reader#info=devDependencies)
[![Known Vulnerabilities](https://snyk.io/test/github/hlxjs/hlx-file-reader/badge.svg)](https://snyk.io/test/github/hlxjs/hlx-file-reader)
[![XO code style](https://img.shields.io/badge/code_style-XO-5ed9c7.svg)](https://github.com/sindresorhus/xo)

# hlx-file-reader

A readable stream that reads an HLS stream and populates [`hls-parser`](https://github.com/kuu/hls-parser) objects

## Features
* Provides a readable stream that can be used for extracting particular variants/renditions from a running live/VOD HLS stream
  * Downloads and parses HLS playlists based on [the spec](https://tools.ietf.org/html/draft-pantos-http-live-streaming-21).
  * Provides a hook for the client to choose which variant(s) and rendition(s) to be downloaded.
  * Populates playlists and segments as structured JS objects ( [`hls-parser`](https://github.com/kuu/hls-parser) objects) that can be read via event listeners

## Install
[![NPM](https://nodei.co/npm/hlx-file-reader.png?mini=true)](https://nodei.co/npm/hlx-file-reader/)

## Usage
```js
const {createReadStream} = require('hlx-file-reader');
// Create a readable stream from a URL
const stream = createReadStream('https://foo.com/bar.m3u8');
// a hook for filtering variants (optional)
stream.on('variants', (variants, cb) => {
  // Choose variants to download (default: all)
  const variantsToLoad = [];
  for (let [index, variant] of variants.entries()) {
    if (variant.bandwidth >= MIN_BITRATE) {
      variantsToLoad.push(index);
    }
  }
  return cb(variantsToLoad);
})
// a hook for filtering renditions (optional)
.on('renditions', (renditions, cb) => {
  // Choose renditions to download (default: all)
  const renditionsToLoad = [];
  for (let [index, rendition] of renditions.entries()) {
    if (rendition.type === 'AUDIO') {
      renditionsToLoad.push(index);
    }
  }
  return cb(renditionsToLoad);
})
.on('data', data => {
  // `data` is an hls-parser object
  // For the details of the object structure, see the hls-parser's document
  if (data.type === 'playlist') {
    console.log(`${data.isMasterPlaylist ? 'Master' : 'Media'} playlist`);
  } else if (data.type === 'segment') {
    console.log(`#${data.mediaSequenceNumber}: duration = ${data.duration}, byte length = ${data.data.length}`);
  }
})
.on('end', () => {
  // For VOD streams, the stream ends after all data is consumed.
  // For Live streams, the stream continues until the ENDLIST tag.
  console.log('Done');
})
.on('error', err => {
  console.error(err.stack);
});

// To emit 'variants' and 'renditions' events again
stream.updateVariant();
```

## API
The features are built on top of the Node's [readable streams](https://nodejs.org/api/stream.html#stream_readable_streams).

### `createReadStream(location[, options])`
Creates a new `ReadStream` object.

#### params
| Name    | Type   | Required | Default | Description   |
| ------- | ------ | -------- | ------- | ------------- |
| location     | string | Yes      | N/A     | A local file path or a url of the playlist  |
| options | object | No       | {}      | See below     |

#### options
| Name        | Type   | Default | Description                       |
| ----------- | ------ | ------- | --------------------------------- |
| concurrency | number | 6       | Max number of requests concurrently processed |
| rootPath | string | CWD  | Required if the `location` is a local file path and any root relative URLs (starting with '/') are contained in the playlist |
| rawResponse | boolean | false   | If true, the segment file (`Segment.data`) is read as a readable stream, default is as a `Buffer` |

#### return value
An instance of `ReadStream`.

### `ReadStream`
A subclass of [`stream.Readable`](https://nodejs.org/api/stream.html#stream_readable_streams) with additional events and methods as follows.

#### events

##### `'variants'`
`variants` event is emitted to let clients choose which variants to be passed to the subsequent streams. Listen for this event if you want to perform any filtering otherwise every variants will be passed to the subsequent streams. The event listener is called synchronously with the following arguments:

| Name     | Type       | Description                                       |
| -------- | ---------- | ------------------------------------------------- |
| variants | [`Variant`]    | A list of available variants                |
| cb       | `function` | A callback function used by clients to choose which variants to be loaded. `cb` takes a single argument of type `[number]`, an array contains the indices of `variants` to be loaded. The filtering won't happen unless you call this function.  |

##### `'renditions'`
`renditions` event is emitted to let clients choose which renditions to be passed to the subsequent streams. Listen for this event if you want to perform any filtering otherwise every renditions will be passed to the subsequent streams. The event listener is called synchronously with the following arguments:

| Name       | Type       | Description                                       |
| ---------- | ---------- | ------------------------------------------------- |
| renditions | [`Rendition`]    | A list of available renditions              |
| cb         | `function` | A callback function used by clients to choose which renditions to be loaded. `cb` takes a single argument of type `[number]`, an array contains the indices of `renditions` to be loaded. The filtering won't happen unless you call this function. |

##### `'data'`
`data` event is emitted for each playlist and segment. The event listener is called with the following arguments:

| Name    | Type      | Description              |
| ------- | --------- | ------------------------ |
| data | `Data` | An [`hls-parser`](https://github.com/kuu/hls-parser) data object (An instance of `Segment`/`MasterPlaylist`/`MediaPlaylist`) |

#### methods

##### `updateVariant()`
Emits `variants`/`renditions` events again so that the client can choose another set of variants/renditions, which in turn emits `data` events. The method takes no params and returns no value.
