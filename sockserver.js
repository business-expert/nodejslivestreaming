"use strict"

//require----------------------------------------------------------------------
var fs     = require('fs');
var net    = require('net');
var http   = require('http');
var url    = require('url');
var path   = require('path');

var events = require('events');
var dbPool = require('sfj/mysql');

//globals----------------------------------------------------------------------
var dataRoot	 = "/home/buffer/"
var localPool    = dbPool({host:'localhost', user:'root', password:'password123', database:'rmss_appliance'});
var sessionQueue = []; //Task Object {cmd:Comand, args:{}, status:'none||inprocess||failed||done' statusDetails:""}
var loaderQueue  = []; //loader queue {sessionKey:[sessionID-sessionName], resource:[resource-url], attempts:0}
var retryQueue   = [];

//_now-------------------------------------------------------------------------
function _now(){
	return parseInt(Math.floor(new Date().getTime()*0.001));
}

//does Session Exist?----------------------------------------------------------
function sessionExists(req){
	return sessionQueue[req.sessionID+'-'+req.sessionName];	
}

//fs exists--------------------------------------------------------------------
function fsExists(target){
	var stats = null;				
	
	try {
		stats = fs.statSync(target);
		return stats;
	}catch(err){
		console.log(err);
	}
	return null;
}	

//parse m3u8 attributes--------------------------------------------------------
var attributeSeparator = function attributeSeparator(){
	var key = '[^=]*';
	var value = '"[^"]*"|[^,]*';
	var keyvalue = '(?:' + key + ')=(?:' + value + ')';

	return new RegExp('(?:^|,)(' + keyvalue + ')');
};

var parseAttributes = function parseAttributes(attributes) {
	// split the string using attributes as the separator
	var attrs = attributes.split(attributeSeparator());
	var i = attrs.length;
	var result = {};
	var attr = undefined;

	while (i--) {
		// filter out unmatched portions of the string
		if (attrs[i] === '') {
			continue;
		}
	
		// split the key and value
		attr = /([^=]*)=(.*)/.exec(attrs[i]).slice(1);
		// trim whitespace and remove optional quotes around the value
		attr[0] = attr[0].replace(/^\s+|\s+$/g, '');
		attr[1] = attr[1].replace(/^\s+|\s+$/g, '');
		attr[1] = attr[1].replace(/^['"](.*)['"]$/g, '$1');
		result[attr[0]] = attr[1];
	}
	return result;
};

//manifest callBack------------------------------------------------------------
function parseManifest(result){

	var lines = result.split('\n');
	var isM3u8  = false;
	var playList= null;
	var line, parts, tokens, s;
	
	while(line=lines.shift()){
		if ( isM3u8 ){
			parts = line.split(':');
			switch(parts[0]){
				case '#EXT-X-STREAM-INF':
					playList.isMaster = true;
					if ( parts.length===2 ){
						playList.streams = playList.streams || [];
						var stream = parseAttributes(parts[1]);
						stream['RENDITION-URI'] = lines.shift(); 
						playList.streams.push(stream);
					}
					break;
				case '#EXTINF':
					var frag = {};
					if ( parts.length===2 ){
						tokens = parts[1].split(',');
						frag.duration = tokens[0];
						frag.url = lines.shift(); 								
					}			
					playList.frags = playList.frags || [];
					playList.frags.push(frag);
					break;							
				case '#EXT-X-TARGETDURATION':
					playList['TARGETDURATION']= parts[1]; 
					break;
				case '#EXT-X-ALLOW-CACHE':
					playList['ALLOW-CACHE']   = parts[1];		
					break;
				case '#EXT-X-PLAYLIST-TYPE':
					playList['PLAYLIST-TYPE'] = parts[1]; 				
					break;
				case '#EXT-X-VERSION':
					break;
				case '#EXT-X-MEDIA-SEQUENCE':
					break;
				case '#EXT-X-ENDLIST':
					playList.hasEndTag = true;
					break;
				default:			
			}					
		}else{
			if ( line==='#EXTM3U' ){
				isM3u8  = true;
				playList= {isMaster:false};					
			}
		}
	}
	return(playList);
}

//Manifest Loader---------------------------------------------------------------
function loadManifest(options, callBack){
	if ( callBack && options.host ){
		options.path   = options.path || '/';
		options.method = options.method || 'GET';
		options.port   = options.port || 80;
		var hdNet = http.request(
			options,
			
			function(edge){
				var data = "";
				edge
				.on('data',
					function(chunk){
						data+= chunk;
					}						
				)
				.on('end', 
					function(){						
						callBack(false, data);
					}
				)					
				.on('error', 
					function(e) {		
						callBack(e.message, null);
					}
				);
			}
		);
		hdNet.on('error',
			function(e){
				console.log(e);
				callBack(e.message, null);
			}
		);
		hdNet.end();
	}else{
		callBack('loadManifest missing parameters', null);
	}
}

//loadFragment-----------------------------------------------------------------
function loadFragment(options, resDescriptor, callBack){
	if ( resDescriptor && options && resDescriptor.sessionKey && resDescriptor.resource && options.path ){
		if ( sessionQueue[resDescriptor.sessionKey] ){
			var target = sessionQueue[resDescriptor.sessionKey]['storageLocation']+'/'+path.basename(options.path);
			if ( fsExists(target) ){
				console.log(target+' exists');
			}else{
				console.log('Downloading '+target);
				var tmpTarget = target+'.tmp'
				options.path   = options.path || '/';
				options.method = options.method || 'GET';
				options.port   = options.port || 80;
				var tsFetch = http.request(
					options,
					function(res){					
						var ws = fs.createWriteStream(tmpTarget);
						res
						.on('end', 
							function(){															
								ws.on('close',
									function(e){
										if ( e ){
											console.log(e);
										}else{
											fs.rename(tmpTarget, target,
												function(e){
													if ( e ){
														console.log('Failed to create '+target);
													}else{
														console.log('Got '+target);														
													}
												}															
											);
										}										
									}
								);																				
							}
						)					
						.on('error', 
							function(e) {		
								console.log("Fetch Error: " + e.message);
							}
						)
						.pipe(ws);
					}
				);	
				tsFetch.end();				
			}			
		}
	}else{
		console.log('no options');
	}
}

//load resource----------------------------------------------------------------
function loadResource(){
	var item = loaderQueue.shift();
	
	var urlObj = url.parse(item.resource);
	if ( path.extname(urlObj.pathname) === '.m3u8' ){
		loadManifest(
			{host:urlObj.host, path:urlObj.pathname},
			function(err, rawdata){
				if ( err ){
					console.log(err);
				}else{
					var playList = parseManifest(rawdata);
					if ( playList ){
						if ( playList.hasEndTag ){
							sessionQueue[item.sessionKey].endOfList = true;
							sessionQueue[item.sessionKey].segmentsToFetch = playList.frags;
						}
					}
				}		
			}
		);
	}else if( path.extname(urlObj.pathname) === '.ts' ){
		loadFragment(
			{host:urlObj.host, path:urlObj.pathname},
			item,
			function(err, filename){
				if ( err ){
					console.log(err);
				}else{
					console.log(filename);
				}		
			}
		);
	}else{
		console.log('Invalid resource');
	}
}

//parse eventqueue-------------------------------------------------------------
function parseTaskQueue(){
	if ( loaderQueue.length < 3 ){
		for ( var _key in sessionQueue ){
			if ( sessionQueue[_key].currentStatus === 'loading' ){
				if ( sessionQueue[_key].segmentsToFetch && sessionQueue[_key].segmentsToFetch.length>0 ){
					var frag = sessionQueue[_key].segmentsToFetch.shift(); 
					loaderQueue.push({sessionKey:_key, resource:frag.url, duration:frag.duration});
				}else{
					if ( !sessionQueue[_key].endOfList && (_now() - sessionQueue[_key].plUpdatedAt)>5 ){
						sessionQueue[_key].plUpdatedAt = _now();
						loaderQueue.push({sessionKey:_key, resource:sessionQueue[_key].renditionUri});
					}
				}				
			}	
		}
		
		if ( loaderQueue.length>0 ){
			loadResource();
		}
	}
}

//add Task to Session Queue and trigger run------------------------------------
function pushToSessionQueue(req, newStatus){
	var session = sessionQueue[req.sessionID+'-'+req.sessionName];
	if ( session ){
		session['previousStatus']= session['currentStatus'];
		session['currentStatus'] = newStatus;
	}else{
		session = {
			sessionID:req.sessionID, 
			sessionName:req.sessionName, 
			storageLocation:dataRoot+req.sessionName, 
			renditionUri:req.renditionUri,
			segmentsToFetch:[],
			segmentsFetched:[],
			errorMessages:[],
			plUpdatedAt: 0,
			endOfList:false,			
			previousStatus:'',
			currentStatus:newStatus
		};
	}
	sessionQueue[req.sessionID+'-'+req.sessionName] = session;
	console.log(sessionQueue);
	return sessionQueue[req.sessionID+'-'+req.sessionName];
}

//fetch session folder---------------------------------------------------------
function getSessionFolder(cmdObj){
	var out   = {status:false, msg:''};
	var stats = null;				
	
	try {
		stats = fs.statSync(dataRoot+cmdObj.sessionName);
		out.status = true;
		out.msg = 'Folder '+cmdObj.sessionName+' exists. Download in progress';
	}catch(err){
		try {
			fs.mkdirSync(dataRoot+cmdObj.sessionName, 777);
			out.status = true;
			out.msg = 'Folder '+cmdObj.sessionName+' has been created. Download in progress';										
		}catch(e){
			console.log(e);
			out.status = false;
			out.msg = 'Failed to create Folder '+cmdObj.sessionName;				
		}
	}
	return out;
}	

//parse cmd string into json and push||process command-------------------------
function parseCmd(str){
	var out = {status:false, msg:"command parser error"};
	try{
		var cmdObj = JSON.parse(str);
	}catch(e){
		console.log(e);
		return out;
	}	
	
	switch (cmdObj.cmd){
		case 'session.start':
			if ( cmdObj.sessionID && cmdObj.sessionName ){
				var statFolder = getSessionFolder(cmdObj); 
				if ( statFolder && statFolder.status){
					if ( pushToSessionQueue(cmdObj, 'loading') ){
						return {status:true, msg:'Session started'};
					}else{								
						return {status:false, msg:'Failed to start session'};
					}
				}else{
					return statFolder?statFolder:{status:false, msg:'Failed to stat Folder'};
				}
			}else{
				out.msg = 'Missing session name or ID';
			}
			break;
		case 'session.pause':
			if ( sessionExists(cmdObj) ){
				if ( pushToSessionQueue(cmdObj, 'paused') ){
					return {status:true, msg:'Session paused'};
				}else{								
					return {status:false, msg:'Failed to pause session'};
				}				
			}else{
				return {status:false, msg:'Session is not queued'};
			}
			break;
		case 'session.resume':
			if ( sessionExists(cmdObj) ){		
				if ( pushToSessionQueue(cmdObj, 'loading') ){
					return {status:true, msg:'Session resumed'};
				}else{								
					return {status:false, msg:'Failed to resume session'};
				}
			}else{
				return {status:false, msg:'Session is not queued'};
			}				
			break;
		default:
			out.msg = 'unsupported command';
			break;
	}
	return out;
}

//create, bind and start the domain socket server------------------------------
var server = net.createServer(
	function(sockClient){
		console.log('Incoming client connection');
		var buf = "";
		sockClient
		.on('data',
			function(data){	
				console.log(data.toString());
				buf+= data.toString();
				
				if ( buf.substring(buf.length-2) === '\r\l' ){
					buf = buf.substring(0, buf.length-2);
					var res = JSON.stringify(parseCmd(buf));
					console.log("Res:"+res);
					sockClient.write(res, function(e){sockClient.end();});
				}
			}
		)
		.on('end', 
			function() {
				console.log('server disconnected');						
			}
		);
	}
);

server.listen('/home/domsocks/daemonsock', 
	function() { //'listening' listener
		console.log('server bound');
	}
).on('error', 
	function(e) {
		if (e.code !== 'EADDRINUSE') throw e;
		net.connect({ path: '/home/domsocks/daemonsock' }, 
			function(){
				//re-throw
				throw e;
			}
		).on('error', 
			function(e){
				if (e.code !== 'ECONNREFUSED') throw e;
				// not in use: delete it and re-listen
				fs.unlinkSync('/home/domsocks/daemonsock');
				server.listen('/home/domsocks/daemonsock');
			}
		);
	}
);

var timeOut = setInterval( function(){parseTaskQueue()}, 2000 );
