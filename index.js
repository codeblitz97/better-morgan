/*!
 * better-morgan
 * Copyright(c) 2023 express.
 * Copyright(c) 2023 Morgan
 * Copyright(c) 2023 Mohtasim Alam Sohom
 * MIT Licensed
 */

"use strict";

/**
 * Module exports.
 * @public
 */

module.exports = betterMorgan;
module.exports.compile = compile;
module.exports.format = format;
module.exports.token = token;

/**
 * Module dependencies.
 * @private
 */

let auth = require("basic-auth");
let debug = require("debug")("morgan");
let deprecate = require("depd")("morgan");
let onFinished = require("on-finished");
let onHeaders = require("on-headers");

/**
 * Array of CLF month names.
 * @private
 */

let CLF_MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Default log buffer duration.
 * @private
 */

let DEFAULT_BUFFER_DURATION = 1000;

/**
 * Create a logger middleware.
 *
 * @public
 * @param {String|Function} format
 * @param {Object} [options]
 * @return {Function} middleware
 */

function betterMorgan(format, options) {
  let fmt = format;
  let opts = options || {};

  if (format && typeof format === "object") {
    opts = format;
    fmt = opts.format || "default";

    deprecate(
      "morgan(options): use morgan(" +
        (typeof fmt === "string" ? JSON.stringify(fmt) : "format") +
        ", options) instead"
    );
  }

  if (fmt === undefined) {
    deprecate("undefined format: specify a format");
  }

  let immediate = opts.immediate;
  let skip = opts.skip || false;
  let formatLine = typeof fmt !== "function" ? getFormatFunction(fmt) : fmt;
  let buffer = opts.buffer;
  let stream = opts.stream || process.stdout;

  if (buffer) {
    deprecate("buffer option");
    stream = createBufferStream(
      stream,
      typeof buffer !== "number" ? DEFAULT_BUFFER_DURATION : buffer
    );
  }

  return function logger(req, res, next) {
    req._startAt = undefined;
    req._startTime = undefined;
    req._remoteAddress = getip(req);

    res._startAt = undefined;
    res._startTime = undefined;

    recordStartTime.call(req);

    function logRequest() {
      if (skip !== false && skip(req, res)) {
        debug("skip request");
        return;
      }

      let line = formatLine(betterMorgan, req, res);

      if (line == null) {
        debug("skip line");
        return;
      }

      debug("log request");
      stream.write(line + "\n");
    }

    if (immediate) {
      logRequest();
    } else {
      onHeaders(res, recordStartTime);
      onFinished(res, logRequest);
    }

    next();
  };
}

/**
 * Apache combined log format.
 */

betterMorgan.format(
  "combined",
  ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'
);

/**
 * Apache common log format.
 */

betterMorgan.format(
  "common",
  ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length]'
);

/**
 * Default format.
 */

betterMorgan.format(
  "default",
  ':remote-addr - :remote-user [:date] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'
);
deprecate.property(
  betterMorgan,
  "default",
  "default format: use combined format"
);

/**
 * Short format.
 */

betterMorgan.format(
  "short",
  ":remote-addr :remote-user :method :url HTTP/:http-version :status :res[content-length] - :response-time ms"
);

/**
 * Tiny format.
 */

betterMorgan.format(
  "tiny",
  ":method :url :status :res[content-length] - :response-time ms"
);

/**
 * dev (colored)
 */

betterMorgan.format("dev", function developmentFormatLine(tokens, req, res) {
  // Get the request type
  let requestType = tokens.method(req, res);

  // Set colors and formatting based on the request type
  let requestColor =
    requestType === "GET"
      ? "\x1b[1;32m" // bold green for GET
      : requestType === "DELETE"
      ? "\x1b[1;31m" // bold red for DELETE
      : requestType === "PUT"
      ? "\x1b[1;33m" // bold yellow for PUT
      : requestType === "POST"
      ? "\x1b[1;34m" // bold blue for POST
      : "\x1b[0m"; // no color for other methods

  // Get the status code if response written
  let status = headersSent(res) ? res.statusCode : undefined;

  // Get status color
  let statusColor =
    status >= 500
      ? "\x1b[31m" // red
      : status >= 400
      ? "\x1b[33m" // yellow
      : status >= 300
      ? "\x1b[36m" // cyan
      : status >= 200
      ? "\x1b[32m" // green
      : "\x1b[0m"; // no color

  // Get the response time
  let responseTime = tokens["response-time"](req, res);

  // Set colors based on the response time
  let timeColor =
    responseTime <= 300
      ? "\x1b[32m" // green for <= 300ms
      : responseTime <= 600
      ? "\x1b[93m" // light yellow for 300-600ms
      : responseTime <= 900
      ? "\x1b[33m" // yellow for 600-900ms
      : "\x1b[31m"; // red for > 900ms

  // Compile the format with colors
  let format = `${requestColor}:method\x1b[0m ${requestColor}\x1b[0m:url\x1b[0m ${statusColor}:status\x1b[0m ${timeColor}:response-time ms - :res[content-length]\x1b[0m`;

  // Compile the format if it doesn't exist
  if (!developmentFormatLine[format]) {
    developmentFormatLine[format] = compile(format);
  }

  // Return the compiled format
  return developmentFormatLine[format](tokens, req, res);
});

/**
 * request url
 */

betterMorgan.token("url", function getUrlToken(req) {
  return req.originalUrl || req.url;
});

/**
 * request method
 */

betterMorgan.token("method", function getMethodToken(req) {
  return req.method;
});

/**
 * response time in milliseconds
 */

betterMorgan.token(
  "response-time",
  function getResponseTimeToken(req, res, digits) {
    if (!req._startAt || !res._startAt) {
      // missing request and/or response start time
      return;
    }

    // calculate diff
    let ms =
      (res._startAt[0] - req._startAt[0]) * 1e3 +
      (res._startAt[1] - req._startAt[1]) * 1e-6;

    // return truncated value
    return ms.toFixed(digits === undefined ? 3 : digits);
  }
);

/**
 * total time in milliseconds
 */

betterMorgan.token("total-time", function getTotalTimeToken(req, res, digits) {
  if (!req._startAt || !res._startAt) {
    // missing request and/or response start time
    return;
  }

  // time elapsed from request start
  let elapsed = process.hrtime(req._startAt);

  // cover to milliseconds
  let ms = elapsed[0] * 1e3 + elapsed[1] * 1e-6;

  // return truncated value
  return ms.toFixed(digits === undefined ? 3 : digits);
});

/**
 * current date
 */

betterMorgan.token("date", function getDateToken(req, res, format) {
  let date = new Date();

  switch (format || "web") {
    case "clf":
      return clfdate(date);
    case "iso":
      return date.toISOString();
    case "web":
      return date.toUTCString();
  }
});

/**
 * response status code
 */

betterMorgan.token("status", function getStatusToken(req, res) {
  return headersSent(res) ? String(res.statusCode) : undefined;
});

/**
 * normalized referrer
 */

betterMorgan.token("referrer", function getReferrerToken(req) {
  return req.headers.referer || req.headers.referrer;
});

/**
 * remote address
 */

betterMorgan.token("remote-addr", getip);

/**
 * remote user
 */

betterMorgan.token("remote-user", function getRemoteUserToken(req) {
  // parse basic credentials
  let credentials = auth(req);

  // return username
  return credentials ? credentials.name : undefined;
});

/**
 * HTTP version
 */

betterMorgan.token("http-version", function getHttpVersionToken(req) {
  return req.httpVersionMajor + "." + req.httpVersionMinor;
});

/**
 * UA string
 */

betterMorgan.token("user-agent", function getUserAgentToken(req) {
  return req.headers["user-agent"];
});

/**
 * request header
 */

betterMorgan.token("req", function getRequestToken(req, res, field) {
  // get header
  let header = req.headers[field.toLowerCase()];

  return Array.isArray(header) ? header.join(", ") : header;
});

/**
 * response header
 */

betterMorgan.token("res", function getResponseHeader(req, res, field) {
  if (!headersSent(res)) {
    return undefined;
  }

  // get header
  let header = res.getHeader(field);

  return Array.isArray(header) ? header.join(", ") : header;
});

/**
 * Format a Date in the common log format.
 *
 * @private
 * @param {Date} dateTime
 * @return {string}
 */

function clfdate(dateTime) {
  let date = dateTime.getUTCDate();
  let hour = dateTime.getUTCHours();
  let mins = dateTime.getUTCMinutes();
  let secs = dateTime.getUTCSeconds();
  let year = dateTime.getUTCFullYear();

  let month = CLF_MONTH[dateTime.getUTCMonth()];

  return (
    pad2(date) +
    "/" +
    month +
    "/" +
    year +
    ":" +
    pad2(hour) +
    ":" +
    pad2(mins) +
    ":" +
    pad2(secs) +
    " +0000"
  );
}

/**
 * Compile a format string into a function.
 *
 * @param {string} format
 * @return {function}
 * @public
 */

function compile(format) {
  if (typeof format !== "string") {
    throw new TypeError("argument format must be a string");
  }

  let fmt = String(JSON.stringify(format));
  let js =
    '  "use strict"\n  return ' +
    fmt.replace(/:([-\w]{2,})(?:\[([^\]]+)\])?/g, function (_, name, arg) {
      let tokenArguments = "req, res";
      let tokenFunction = "tokens[" + String(JSON.stringify(name)) + "]";

      if (arg !== undefined) {
        tokenArguments += ", " + String(JSON.stringify(arg));
      }

      return (
        '" +\n    (' + tokenFunction + "(" + tokenArguments + ') || "-") + "'
      );
    });

  // eslint-disable-next-line no-new-func
  return new Function("tokens, req, res", js);
}

/**
 * Create a basic buffering stream.
 *
 * @param {object} stream
 * @param {number} interval
 * @public
 */

function createBufferStream(stream, interval) {
  let buf = [];
  let timer = null;

  // flush function
  function flush() {
    timer = null;
    stream.write(buf.join(""));
    buf.length = 0;
  }

  // write function
  function write(str) {
    if (timer === null) {
      timer = setTimeout(flush, interval);
    }

    buf.push(str);
  }

  // return a minimal "stream"
  return { write: write };
}

/**
 * Define a format with the given name.
 *
 * @param {string} name
 * @param {string|function} fmt
 * @public
 */

function format(name, fmt) {
  betterMorgan[name] = fmt;
  return this;
}

/**
 * Lookup and compile a named format function.
 *
 * @param {string} name
 * @return {function}
 * @public
 */

function getFormatFunction(name) {
  // lookup format
  let fmt = betterMorgan[name] || name || betterMorgan.default;

  // return compiled format
  return typeof fmt !== "function" ? compile(fmt) : fmt;
}

/**
 * Get request IP address.
 *
 * @private
 * @param {IncomingMessage} req
 * @return {string}
 */

function getip(req) {
  return (
    req.ip ||
    req._remoteAddress ||
    (req.connection && req.connection.remoteAddress) ||
    undefined
  );
}

/**
 * Determine if the response headers have been sent.
 *
 * @param {object} res
 * @returns {boolean}
 * @private
 */

function headersSent(res) {
  // istanbul ignore next: node.js 0.8 support
  return typeof res.headersSent !== "boolean"
    ? Boolean(res._header)
    : res.headersSent;
}

/**
 * Pad number to two digits.
 *
 * @private
 * @param {number} num
 * @return {string}
 */

function pad2(num) {
  let str = String(num);

  // istanbul ignore next: num is current datetime
  return (str.length === 1 ? "0" : "") + str;
}

/**
 * Record the start time.
 * @private
 */

function recordStartTime() {
  this._startAt = process.hrtime();
  this._startTime = new Date();
}

/**
 * Define a token function with the given name,
 * and callback fn(req, res).
 *
 * @param {string} name
 * @param {function} fn
 * @public
 */

function token(name, fn) {
  betterMorgan[name] = fn;
  return this;
}
