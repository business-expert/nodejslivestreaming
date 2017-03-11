/******************************************************************************
**	Author: 		Nikolaos Cheropoulos (NC)
**	Description: 	M3u8 and ts segment loader
**	Params:			none
**  Returns:        none  
**	History:		Created 2016-10-17 by NC
******************************************************************************/

"use strict";
//require----------------------------------------------------------------------
var http    = require('http');
var path    = require('path');
var url     = require('url');
var qs      = require('querystring');
var fs      = require('fs');

//globals vars------------------------------------------------------------------

var lastRun = false;
var today   = new Date();
var curStore= today.getFullYear()+'_'+(today.getMonth()+1)+'_'+today.getDate();

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

//Manifest Loader---------------------------------------------------------------
function loadManifest(options, callBack){
	console.log(options);
	if ( callBack && options.host ){
		options.path   = options.path || '/';
		options.method = options.method || 'GET';
		options.port   = options.port || 80;
		var hdNet = http.request(
			options,
			
			function(edge){
				var data = new Buffer(0,'utf-8');
				edge
				.on('data',
					function(chunk){
						data = Buffer.concat([data, chunk]);
					}						
				)
				.on('end', 
					function(){						
						callBack(false, data.toString('utf-8'));
					}
				)					
				.on('error', 
					function(e) {		
						callBack(e.message, null);
					}
				);
			}
		);	
		hdNet.end();
	}else{
		callBack('loadManifest missing parameters', null);
	}
}

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
						playList.streams = playList.streams || []
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
				
					break;
				case '#EXT-X-ALLOW-CACHE':
					break;
				case '#EXT-X-PLAYLIST-TYPE':
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
				playList= {};
				
			}
		}
	}
	return(playList);
}

//fetch items in list----------------------------------------------------------
function fetchSegment(){

}

//main-------------------------------------------------------------------------
if ( process.argv.length > 2 ){
	var urlObj = url.parse(process.argv[2]);
	loadManifest(
		{host:urlObj.host, path:urlObj.path},
		function(err, rawdata){
			if ( err ){
				console.log(error);
			}else{
				var m3u8Obj = parseManifest(rawdata);
				if ( m3u8Obj ){
					if ( m3u8Obj.isMaster ){
						if (m3u8Obj.streams.length>0){
							urlObj = url.parse(m3u8Obj.streams[0]['RENDITION-URI']);
							loadManifest({host:urlObj.host, path:urlObj.path},
								function(err, result){
									var streamObj = parseManifest(result);
									console.log(streamObj);
								}
							);
						}else{
							console.log('Corrupt master.m3u8');
						}					
					}else{
					
					}				
				}else{
					console.log('No m3u8 object');
				}
			}		
		}
	);
}else{
	console.log('No source');
	process.exit(-1);
}
