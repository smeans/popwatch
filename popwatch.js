var util = require("util");
var fs = require('fs');
var querystring = require('querystring');
var http = require('http');
var POP3Client = require('poplib');

var args = process.argv.slice(2);

if (!args.length) {
  console.log('usage: popwatch config.json [config.json]+');
  process.exit();
}

processNextBox();

function parseHeaders(data) {
  var lines = data.split('\r\n');
  var hn;
  var hb = '';
  var ho = {};

  lines.forEach(function (line) {
    var ci = line.indexOf(':');

    if (ci < 0) {
      hb += line;
    } else {
      if (hn) {
        ho[hn] = hb;
      }
      hn = line.substr(0, ci);
      hb = line.substr(ci+1);
    }
  });

  if (hn) {
    ho[hn] = hb;
  }

  return ho;
}

var cfg;

function processNextBox() {
  if (args.length <= 0) {
    return;
  }

  var cfn = args.shift();
  cfg = require('./' + cfn);

  if (verifyConfig(cfg)) {
    processBox(cfg);
  } else {
    console.log('error in ' + cfn + ' config file: not processed');
  }
}

function verifyConfig(cfg) {
  if (!cfg.port) {
    cfg.port = cfg.enabletls ? 995 : 110;
  }

  return cfg.host && cfg.user && cfg.password;
}

function postVerifyInfo(hd, callback) {
  var post_data = querystring.stringify({message_id:hd['Message-ID'], to:hd.To});

  // An object of options to indicate where to post to
  var post_options = cfg.post_endpoint;
  post_options.headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(post_data)
  };

  // Set up the request
  var post_req = http.request(post_options, function(res) {
      res.setEncoding('utf8');
      res.on('data', function (chunk) {
          console.log('Response: ' + chunk);
      });

      res.on('end', function () {
        callback();
      });
  });

  // post the data
  post_req.write(post_data);
  post_req.end();
}

function processBox(cfg) {
  var client = new POP3Client(cfg.port, cfg.host, cfg);

  client.on("error", function(err) {
  	console.log(err);
    process.exit(1);
  });

  client.on('connect', function (data) {
    client.login(cfg.user, cfg.password);
  });

  client.on("login", function(status, data) {
  	if (status) {
  		console.log("LOGIN/PASS success");
  		client.stat();
  	} else {
  		console.log("LOGIN/PASS failed");
  		client.quit();
  	}
  });

  var mc = 0;

  client.on("stat", function(status, data, rawdata) {

  	if (status === true) {

  		console.log("STAT success");
  		if (cfg.debug) console.log("Parsed data: " + util.inspect(data));

      if ((mc = data.count) > 0) {
        fetchNextMessage();
      } else {
        client.quit();
      }
  	} else {

  		console.log("STAT failed");
  		client.quit();

  	}
  });

  function fetchNextMessage() {
    if (mc <= 0) {
      client.quit();

      return;
    }

    client.top(mc, 10);
  }

  client.on("top", function(status, msgnumber, data, rawdata) {
    if (status) {
      console.log('top for message ' + msgnumber);

      var hd = parseHeaders(data);
      console.log(hd);

      postVerifyInfo(hd, function () {
        client.dele(mc--);
      });
    } else {
      client.quit();
    }
  });

  client.on("dele", function(status, msgnumber, data, rawdata) {
    fetchNextMessage();
  });

  client.on("quit", function(status, rawdata) {
    processNextBox();
  });
}
