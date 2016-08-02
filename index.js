var fastcgiConnector = require('fastcgi-client');
module.exports = phpfpm;
var urlencode = require('urlencode-for-php');

/**
 * phpfpm
 * @param  options
 *
 * default options will be  { host:127.0.0.1, port:9000 }
 */
function phpfpm(options)
{
	options = options || {};
	!options.host && (options.host = '127.0.0.1');
	!options.port && (options.port = 9000);
	!options.documentRoot && (options.documentRoot = '');
	!options.serverAddr && (options.serverAddr = '127.0.0.1');
	!options.serverPort && (options.serverAddr = 80);

	this.options = options;
	var self = this;
	options.skipCheckServer = true;
	this.client = fastcgiConnector(options);
	this.ready = false;
	this.client.on('ready', function()
	{
		self.ready = true;
		self._clearQueue();
	});
	this.queue = [];
}

/**
 * clear the queued tasks after connected to phpfpm
 */
phpfpm.prototype._clearQueue = function()
{
	var evt;
	while(evt = this.queue.shift())
	{
		this.run(evt.info, evt.cb);
	}
};

/**
 * send command to phpfpm to run a php script
 */
phpfpm.prototype.run = function(info, cb)
{
	if (typeof info == 'string') info = { method: 'GET', uri: info };
	if (info.url && !info.uri) info.uri = info.url;

	if (!this.ready)
	{
		this.queue.push({info: info, cb:cb});
		return;
	}

	//support form data
	if (info.form && info.method != 'GET')
	{
		info.body = urlencode(info.form);
		info.method = 'POST';
	}

	if (info.form && info.method == 'GET')
	{
		info.body = '';
		var qs = urlencode(info.form);
		info.uri += (info.uri.indexOf('?') === -1) ? '?' + qs : '&' + qs;
	}

	if (info.body && !info.method) info.method = 'POST';

	//support json data
	if (info.json)
	{
		info.body = JSON.stringify(info.json);
		info.method = 'POST';
		info.contentType = 'application/json';
	}

	!info.method && (info.method = 'GET');
	info.method = info.method.toUpperCase();
	if (info.method == 'POST')
	{
		!info.body && (info.body = '');
		if (typeof info.body === 'string') info.body = new Buffer(info.body, 'utf8');
		!info.contentType && (info.contentType = 'application/x-www-form-urlencoded');
		!info.contentLength && (info.contentLength = info.body.length);
	}

	if (info.uri.match(/\?/))
	{
		var ms = info.uri.match(/^([^\?]+)\?(.*)$/);
		info.queryString = ms[2];
		info.uri = ms[1];
	}



	var phpfile = info.uri;
	if (!phpfile.match(/^\//)){
		var scriptFilename = this.options.documentRoot + phpfile;
		phpfile = '/' + phpfile;
	}

	var FASTCGI_REQ_HEADERS =
	{
		QUERY_STRING: info.queryString || '',
		REQUEST_METHOD: info.method,
		CONTENT_TYPE: info.contentType || '',
		CONTENT_LENGTH: info.contentLength || '',
		SCRIPT_FILENAME: scriptFilename,
		SCRIPT_NAME: phpfile,
		REQUEST_URI: info.reqUri || info.uri,
		DOCUMENT_URI: phpfile,
		DOCUMENT_ROOT: this.options.documentRoot,
		SERVER_PROTOCOL: 'HTTP/1.1',
		GATEWAY_INTERFACE: 'CGI/1.1',
		REMOTE_ADDR: '127.0.0.1',
		REMOTE_PORT: 1234,
		SERVER_ADDR: this.options.serverAddr,
		SERVER_PORT: this.options.serverPort,
		SERVER_NAME: info.serverName || this.options.serverAddr,
		SERVER_SOFTWARE: 'node-phpfpm',
		REDIRECT_STATUS: 200,
	};

	if(info.httpHeaders){
		for(var header in info.httpHeaders) {
			var headerName = header.toUpperCase().replace(/-/g, '_');
			FASTCGI_REQ_HEADERS['HTTP_' + headerName] = info.httpHeaders[header];
		}

		info.sendHttpHeaders = true;
	}

	var self = this;

	self.client.request(FASTCGI_REQ_HEADERS, function(err, request)
	{

		if (err)
		{
			cb(99, err.toString(), err.toString());
			return;
		}

		var output = '', errors = '', body = '', headers = {};
		request.stdout.on('data', function(data)
		{
			body += data.toString('utf8');
		});

		request.stderr.on('data', function(data)
		{
			errors += data.toString('utf8');
		});
		
		request.stdout.on('end', function()
		{
			var headersString = body.match(/(^[\s\S]*?)\r\n\r\n/)[1];

			body = body.substr(headersString.length + 4); //remove headers and \r\n characters

			if(info.sendHttpHeaders){
				var headersArray = headersString.split('\r\n'),
					headersObj = {};
				headersArray.map(function (header) {
					var delimiter = header.indexOf(':');
					headersObj[header.substr(0, delimiter)] = header.substr(delimiter + 2);
				});

				headers = headersObj;

				output = { headers : headers, body : body };
			} else {
				output = body;
			}

			cb(false, output, errors);
		});

		if (info.method == 'POST')
		{
	 		request.stdin._write(info.body, 'utf8');
		}
		request.stdin.end();
	});
};
