var https   	= require('https');
var http    	= require('http');
var	url     	= require('url');
var	qs      	= require('querystring');
var path    	= require('path');
var fs      	= require('fs');
var crypto  	= require('crypto');
var cp      	= require('child_process');
var dbPool 		= require('sfj/mysql');
var RmssClient	= require('sfj/rmsscli');
var parseM3u8	= require('sfj/m3u8');
var net         = require('net');
var os			= require('os');

var hash = '60c0bb020c178c9bf88f02cd3e07290e';
//prototypes-------------------------------------------------------------------
http.IncomingMessage.prototype.clientIP = function(){
	if ( this.headers['X-Forwarded-For'] ){
		return (this.headers['X-Forwarded-For']);
	}
	return(this.connection.remoteAddress);
}; 
	
http.IncomingMessage.prototype.pathName = function(){
	var uri = url.parse(this.url);
	return (uri.pathname.replace(/^\/|\/$/g, '').trim());	
}

http.IncomingMessage.prototype.pathTokens = function(){		
	return (this.pathName().split('/'));
};

http.IncomingMessage.prototype.getQueryFields = function(){
	var queryStr = url.parse(this.url).query;
	return qs.parse(queryStr);
};
	
http.IncomingMessage.prototype.parsePostData = function(callback, encoding){	//raw post data to assoc array
	var raw = "";
	
	if ( encoding ){
		this.setEncoding(encoding);
	}else{
		this.setEncoding('utf-8');
	}
	
	if ( callback instanceof Function ){
		this
			.on('data', function(chunk){raw+=chunk;})
			.on('error', function(e){callback(e, null);})
			.on('end', function(){
				callback(null, qs.parse(raw));
			}
		);
		return true;
	}
};

http.IncomingMessage.prototype.getCookie = function(key){
	if ( this._cookiesArr === undefined ){
		this._cookiesArr = {};
		if ( this.headers && this.headers.cookie ){
			var list = this.headers.cookie.split('; ');
			for ( var i=0; i<list.length; ++i ){
				if ( list[i].indexOf('=')>0 && list[i].length>list[i].indexOf('=') ){
					this._cookiesArr[list[i].substring(0, list[i].indexOf('='))] =  list[i].substring(1+list[i].indexOf('='));
				}
			}
		}
	}
	return (key===undefined)?this._cookiesArr:this._cookiesArr[key];
};

http.IncomingMessage.prototype.getSession = function(){	
	var sid = this.getCookie('sfjSid');
	if ( sid ){
		if ( sessionStore[sid] ){
			var ts = Math.round(new Date().getTime()/1000);
			if ( sessionStore[sid].lastPing+18000 > ts ){
				sessionStore[sid].lastPing = ts;
				return sessionStore[sid];
			}
		}
	}
	return null;
}

http.ServerResponse.prototype.startSession = function(sid){		
	var expDate = new Date(); expDate.setHours(expDate.getHours()+5);		
	this.setHeader('Set-Cookie', 'sfjSid='+sid+'; Path=/; expires='+expDate.toUTCString()+';');
}

http.ServerResponse.prototype.stopSession = function(sid){		
	if ( sessionStore.sid ) delete sessionStore.sid;
	
	var expDate = new Date(); expDate.setHours(expDate.getHours()-10);		
	this.setHeader('Set-Cookie', 'sfjSid=; Path=/; expires='+expDate.toUTCString()+';');
	this.writeHead(302, {Location: '/'});
	this.end();
}

//Global variables-------------------------------------------------------------		
var contentTypes = {
	'.css':  'text/css',
	'.js':   'text/javascript',
	'.html': 'text/html',
	'.m3u8': 'application/vnd.apple.mpegurl',
	'.ts':   'video/MP2T',
	'.mpg' : 'video/mpeg',
	'.mp4' : 'video/mpeg',
	'.mpeg': 'video/mpeg',	
	'.gif' : 'image/gif',
    '.jpg' : 'image/jpeg',
    '.jpeg': 'image/jpeg',	
    '.png' : 'image/png',
	'.ico' : 'image/x-icon',
	'.woff': 'application/font-woff'
};

var sessionStore = {};
var Secret = 'ThiSisNonEoFyOurBeEsWaX';

//global methods---------------------------------------------------------------
function resText(res, msg){
	res.writeHead(200, {'Content-Type': 'text/plain'});
	res.write(msg);	
	res.end();	
}

function resJson(res, msg){
	res.writeHead(200, {'Content-Type': 'text/plain'});
	res.write(JSON.stringify(msg));	
	res.end();	
}

function res405(res){
	res.writeHead(405, {'Content-Type': 'text/plain', 'Connection': 'close'});
	res.end('Request Denied');		
}

function res404(res){
	res.writeHead(404, {'Content-Type': 'text/plain', 'Connection': 'close'});
	res.end('File Not Found');	
}

function serveStatic(filePath, res){ //serve if file exists and content type allowed
	console.log(filePath);
	if ( filePath && contentTypes[path.extname(filePath)] ){
		fs.stat(filePath, 
			function (err, stat){			
				if ( err ){
					res404(res);
				}else{
					var resHeaders = {
						'Access-Control-Allow-Origin': '*',
						'Content-Type': contentTypes[path.extname(filePath)],
						'Content-Length': stat.size
					}
				
					res.writeHead(200, resHeaders);
					var stream = fs.createReadStream(filePath, {bufferSize: 4096});
					stream
						.on('error',
							function(e){
								res.end('Internal Server Error');
							}
						)
						.on('end',
							function(){
								res.end();
							}
						)					
					.pipe(res);
				}
			}
		);
	}else{
		res405(res);
	}
};  

function sendData(data, callBack){
	var client = net.createConnection("/usr/local/src/ffplayClone/echo_socket");
	var response = "";
	client
		.on("connect", 
			function(){
				console.log('connected');
				client.write(data);
			}
		)
		.on("data", 	
			function(chunk){
				response+= chunk.toString();
				if ( response.indexOf('\n')>-1 ){
					client.end();
				}
			}
		)
		.on("error", 	
			function(ex){
				console.log(ex);
				callBack({status:false, msg:'Connection to playback server failed'});
			}
		)
		client.on('end', 
			function(){
				console.log('On End:'+response+"\nEND\n");
				callBack({status:true, msg:response});
			}
		)
	;
}

//db Connect
var licenseInfo = null;
var localPool   = dbPool({host:'localhost', user:'root', password:'password123', database:'rmss_appliance', multipleStatements:true});

//verifyLicense----------------------------------------------------------------
function verifyLicense(callBack){
	if ( licenseInfo && licenseInfo.license_status && licenseInfo.license_status === 1 ){ 
		callBack(true);
	}else{
		localPool.exec('select * from license_info where license_status = ? order by uid desc limit 1', [1],
			function(err, recSet){
				if ( err ){
					callBack(false);
				}else{
					if ( recSet.length === 1 ){
						licenseInfo = recSet[0];
						callBack(true);
					}else{
						callBack(false);
					}
				}
			}		
		)
	}
}

function makeSessionName(){
	var d = new Date();

	var yyyy = d.getUTCFullYear().toString();
	var mm   = (d.getUTCMonth()+1).toString();
	var dd   = d.getUTCDate().toString();
	var hh   = d.getUTCHours().toString();
	var mn   = d.getUTCMinutes().toString();
	var sc   = d.getUTCSeconds().toString();
	
	return yyyy+'_'+(mm[1]?mm:"0"+mm[0])+'_'+(dd[1]?dd:"0"+dd[0])+'_'+(hh[1]?hh:"0"+hh[0])+'_'+(mn[1]?mn:"0"+mn[0])+'_'+(sc[1]?mn:"0"+sc[0]);
}

function dfByFolder(folder, callBack){
	cp.exec('df --total '+folder, 
		function(err, stdout, stderr){
			if (err) {
				console.log(err);
				callBack(err, null);
			}else{
				var lines = stdout.trim().split('\n');
				var parts = lines[lines.length-1].trim().match(/\S+/g)||[];
				if ( parts.length === 5 ){
					callBack(null, {total:parts[1], used:parts[2], available:parts[3], usage:parts[4], units:'KB'});
				}else{
					callBack({message:'Invalid response'}, null);
				}
			}
		}
	);
}

//main client request loop-----------------------------------------------------
function onRequest(req, res){	
	var now     	= parseInt(Math.floor(new Date().getTime()*0.001));
	var method  	= req.method.toUpperCase();
	var pathname	= req.pathName();
	var extension 	= path.extname(pathname);
	var tokens    	= req.pathTokens();	
	
	verifyLicense(
		function(hasLicense){
			var out = {status:false, msg:"Invalid Request"};		
			if ( hasLicense ){
				switch(tokens.shift()){
					case 'performance':
						switch(tokens.shift()){
							case 'loadavg':
								out.status = true;
								out.loadavg = os.loadavg();
								out.msg = '';
								resJson(res, out);
								break;
							case 'memusage':
								out.status = true;
								out.memory = {total:os.totalmem(), free:os.freemem()};								
								out.msg = '';
								resJson(res, out);
								break;
							case 'cpus':
								out.status = true;
								out.cpus = os.cpus();
								out.msg = '';
								resJson(res, out);
								break;
							case 'diskusage':
								dfByFolder('/home',
									function(err, data){
										if ( data ){
											out.status = true;
											out.diskusage = data;
											out.msg = '';
										}else{
											out.msg = 'Failed to query diskusage';										
										}
										resJson(res, out);
									}
								);
								break;
							default:
								out.msg = "Invalid Method "+method;																				
								resJson(res, out);																		
						}
						break;
					case 'clips':
						switch(method){
							case 'GET':
								localPool.exec('select * from clips', null,
									function(err, recSet){
										if ( err ){
											console.log(err);
											resJson(res, {status:false, msg:'Failed to list local clips'});
										}else{
											resJson(res, {status:true, msg:recSet.length+' Clips found', clips:recSet});
										}
									}		
								);																							
								break;
							case 'PUT':
								var filename = "";
								if ( req.headers['x_filename'] ){
									var uploadSize = 0;
									var bufferStatus = false;
									filename = crypto.createHash('sha256').update(req.headers['x_filename']).digest('hex') + path.extname(req.headers['x_filename']);
									console.log('/home/assets/'+filename);
									var ws = fs.createWriteStream('/home/assets/'+filename);
									
									req
									.on('error',
										function(e){
											out.msg = e.message;																				
											resJson(res, out);											
										}
									)
									.on('end',
										function(){															
											ws.on('close',
												function(e){
													if ( e ){
														out.msg = e.message;																				
														resJson(res, out);											
													}else{
														var newClip = {uri:filename, title:req.headers['x_filename']};
														localPool.exec('insert into clips set ?', newClip,
															function(err, recs){
																out.status = true;
																out.msg = 'Upload Complete';																				
																resJson(res, out);																										
															}
														);													
													}										
												}
											);																				
										}
									)				
									.pipe(ws);
								}else{
									out.msg = "Missing filenme";																				
									resJson(res, out);											
								}							
								break;								
							case 'POST':
								req.parsePostData(
									function(err, fields){
										if (err){
											out.msg = "Missing request data";																				
											resJson(res, out);											
										}else{
											switch(tokens.shift()){	
												case 'switch':
													if (fields.uid1 && fields.oid1 && fields.uid2 && fields.oid2 ){
														localPool.exec('update playback_queue set orderID='+fields.oid1+' where uid='+fields.uid1+'; update playback_queue set orderID='+fields.oid2+' where uid='+fields.uid2+';',
															function(err, recs){
																if ( err ){
																	out.msg = "Failed to reorder clips";																				
																	resJson(res, out);																																																																		
																}else{
																	out.status = true;
																	out.msg = "Clip order has been updated";																				
																	resJson(res, out);																																																																																		
																}
															}
														);
													}else{
														out.msg = "Malformed request";																				
														resJson(res, out);																																																		
													}																								
													break;
												default:
													if ( fields.sessionID && fields.mediaSource ){
														localPool.exec('select orderID from playback_queue where sessionID=? order by orderID desc limit 1', [fields.sessionID],
															function(err, recs){
																if ( err ){
																	out.msg = "Failed to lookup playback queue";																				
																	resJson(res, out);																								
																}else{														
																	fields.orderID = recs.length?parseInt(recs[0].orderID)+1:1;
																	localPool.exec('insert into playback_queue set ?', fields,
																		function(err, recSet){
																			if ( err ){
																				out.msg = err.msg;
																			}else{
																				if ( recSet.insertId && recSet.insertId>0 ){
																					out.status = true;
																					out.msg = 'Clip inserted into playback queue';
																					out.entry = {
																						"uid":recSet.insertId,
																						"sessionID":fields.sessionID,
																						"orderID":fields.orderID,
																						"isEventFeed":0,
																						"mediaSource":fields.mediaSource,
																						"startPos":0,
																						"duration":0,
																						"startedAt":0,
																						"endedAt":0,
																						"status":""
																					};																					
																				}else{
																					out.msg = 'Failed to queue clip';																				
																				}
																			}
																			resJson(res, out);
																		}
																	);
																}
															}
														);
													}else{
														out.msg = "Malformed request";																				
														resJson(res, out);																																					
													}
													break;
											}
										}
									}
								);
								break;						
							case 'DELETE':
								console.log('delete clip');
								req.parsePostData(
									function(err, fields){
										if (err){
											out.msg = "Missing request data";																				
											resJson(res, out);											
										}else{											
											if ( fields && fields.queueID ){
												localPool.exec('delete from playback_queue where uid=? and isEventFeed=?', [fields.queueID, 0],
													function(err, recs){
														if ( err ){
															out.msg = "Failed to lookup playback queue";																																												
														}else{					
															out.status = true;
															out.msg = "Clip has been removed from playback queue";																				
																													
														}
														resJson(res, out);
													}
												);
											}else{
												out.msg = "Missing request data";																				
												resJson(res, out);											
											}
										}
									}
								);
								break;
							default:
								out.msg = "Invalid Method "+method;																				
								resJson(res, out);											
						}					
						break;
					case 'sources':
						switch(method){
							case 'GET':
								var rmss = new RmssClient({region:licenseInfo.rmss_region});
								rmss.get('bymac/'+hash,
									function(err, httpCode, data){											
										if (err){
											out.msg = 'Media Source lookup failed';
											resJson(res, out);
										}else{
											console.log(data);
											if ( httpCode===200 ){
												resJson(res, {status:true, rmss:data});
											}else{
												out.msg = "Invalid request method";
												resJson(res, out);
											}
										}
									}
								);
								break;
							case 'POST':
								req.parsePostData(
									function(err, fields){
										if (err){
											out.msg = "Missing request data";																				
											resJson(res, out);											
										}else{											
											if ( fields && fields.source ){
												console.log(parseM3u8);
												parseM3u8(fields.source, 
													function(err, m3u8){
														if ( err ){
															out.msg = "Invalid M3U8 Playlist";
														}else{
															console.log(m3u8);
															out.status = true;
															out.msg = "Valid M3U8 Playlist";
															out.playList = m3u8;
														}
														resJson(res, out);
													}
												);
											}else{
												out.msg = "Must specify media source URI";																					
												resJson(res, out);												
											}
										}
									}
								);
								break;
							default:
								resJson(res, out);
						}
						break;	
					case 'presets':
						switch(method){
							case 'POST':
								req.parsePostData(
									function(err, fields){
										if (err){
											out.msg = "Missing request data";																				
											resJson(res, out);											
										}else{	
											console.log(fields);
											if ( fields && fields.preset_name && fields.master_uri && fields.renditionID!=undefined && !isNaN(parseInt(fields.renditionID, 10)) ){
												parseM3u8(fields.master_uri, 
													function(err, m3u8){
														if ( err ){
															out.msg = "Invalid M3U8 Playlist";
															resJson(res, out);
														}else{
															fields.created_at = now;
															fields.deleted_at = 0;
														
															if ( m3u8.isMaster ){															
																if ( m3u8.streams.length>fields.renditionID ){
																	fields.rendition_uri = m3u8.streams[fields.renditionID]['RENDITION-URI'];
																	localPool.exec('insert into presets set ?', fields,
																		function(err, recSet){
																			if ( err ){
																				console.log(err);
																				resJson(res, {status:false, msg:'Failed to create preset'});
																			}else{
																				_preset = {uid:recSet.insertId, name:fields.session_name, created_at:fields.created_at};
																				resJson(res, {status:true, msg:'Preset has been created', preset:_preset});
																			}
																		}		
																	);																														
																}else{
																	out.msg = "Rendition daoes not exist";
																	resJson(res, out);																
																}
															}else{
																localPool.exec('insert into presets set ?', fields,
																	function(err, recSet){
																		if ( err ){
																			console.log(err);
																			resJson(res, {status:false, msg:'Failed to create preset'});
																		}else{
																			_preset = {uid:recSet.insertId, name:fields.session_name, created_at:fields.created_at};
																			resJson(res, {status:true, msg:'Preset has been created', preset:_preset});
																		}
																	}		
																);																																													
															}
														}
													}
												);											
											}else{
												out.msg = "Must specify preset name, master source and rendition";																				
												resJson(res, out);																						
											}
										}
									}
								);
								break;
							case 'GET':
								localPool.exec('select * from presets where deleted_at=? order by last_used desc', [0],
									function(err, recSet){
										if ( err ){
											console.log(err);
											resJson(res, {status:false, msg:'Failed to fetch presets'});
										}else{
											resJson(res, {status:true, msg:recSet.length+' presets found', presets:recSet});
										}
									}		
								);																						
								break;
							case 'DELETE':
								var presetID = tokens.shift();
								if ( presetID && !isNaN(parseInt(presetID, 10)) ){
									localPool.exec('update presets set deleted_at=? where uid=?', [now, presetID],
										function(err, recSet){
											if ( err ){
												resJson(res, {status:false, msg:'Failed to delete preset'});
											}else{
												resJson(res, {status:true, msg:'Preset has been deleted'});
											}
										}		
									);
								}else{
									resJson(res, {status:False, msg:'Invalid preset ID'});
								}
								break;
							default:
								resJson(res, out);
								break;			
						}		
						break;						
					case 'sessions':
						var sessionTask = tokens.shift();
						switch(sessionTask){
							case 'new':
								if ( method==='POST' ){
									req.parsePostData(
										function(err, fields){
											if (err){
												out.msg = "Missing request data";																				
												resJson(res, out);											
											}else{	
												if ( fields && fields.presetID ){
													localPool.exec('select * from presets where uid=? and deleted_at=?', [fields.presetID, 0],
														function(err, recSet){
															if (err){
																out.msg = "Failed to look up preset";																				
																resJson(res, out);																										
															}else{
																if ( recSet.length===1 ){
																	var newSession = {
																		preset_id: recSet[0].uid,
																		session_name: makeSessionName(), 
																		master_uri: recSet[0].master_uri,
																		rendition_uri: recSet[0].rendition_uri,
																		width: recSet[0].width,
																		height: recSet[0].height,
																		bandwidth: recSet[0].bandwidth,
																		ulss_region: recSet[0].ulss_region,
																		rmss_region: recSet[0].rmss_region,
																		created_at: now,
																		last_action: now,
																		deleted_at: 0,
																		status: "new"
																	};
																
																	localPool.exec('insert into sessions set ?', newSession,
																		function(err, insRec){
																			if ( err ){
																				console.log(err);
																				resJson(res, {status:false, msg:'Failed to create session'});
																			}else{
																				newSession.uid = insRec.insertId;
																				resJson(res, {status:true, msg:'Preset has been created', session:newSession});
																			}
																		}		
																	);																															
																}else{
																	out.msg = 'No active Preset with ID#'+fields.presetID+' found';																				
																	resJson(res, out);																																										
																}
															}
														}
													);													
												}else{
													out.msg = "Must specify preset";																				
													resJson(res, out);																						
												}
											}
										}
									);								
								}else{
									out.msg = "Invalid Method";																				
									resJson(res, out);																				
								}
								break;
							case 'start': case 'resume':
								if ( method==='POST' ){
									req.parsePostData(
										function(err, fields){
											if (err){
												out.msg = "Missing request data";																				
												resJson(res, out);											
											}else{
												if ( fields && fields.sessionID ){
													localPool.exec('update sessions set status=?, last_action=? where uid=? and deleted_at=?', ['loading', now, fields.sessionID, 0],
														function(err, sqlRes){
															if ( err ){
																console.log(err);
																resJson(res, {status:false, msg:'Failed to query active session'});
															}else{
																console.log(sqlRes);
																if ( sqlRes.changedRows === 1 ){
																	out.status = true;
																	out.msg = "Session has been "+(sessionTask=='start'?'started':'resumed');
																}else{
																	out.msg = "Failed to "+sessionTask+" session";																	
																}
																resJson(res, out);
															}
														}		
													);																																											
												}
											}
										}
									);
								}else{
									out.msg = "Invalid Method";																				
									resJson(res, out);																				
								}														
								break;								
							case 'pause':
								if ( method==='POST' ){
									req.parsePostData(
										function(err, fields){
											if (err){
												out.msg = "Missing request data";																				
												resJson(res, out);											
											}else{
												if ( fields && fields.sessionID ){
													localPool.exec('update sessions set status=?, last_action=? where uid=? and deleted_at=?', ['paused', now, fields.sessionID, 0],
														function(err, sqlRes){
															if ( err ){
																console.log(err);
																resJson(res, {status:false, msg:'Failed to query active session'});
															}else{
																if ( sqlRes.changedRows === 1 ){
																	out.status = true;
																	out.msg = "Session has been paused";
																}else{
																	out.msg = "Failed to "+sessionTask+" session";																	
																}
																resJson(res, out);
															}
														}		
													);																																											
												}
											}
										}
									);								
								}else{
									out.msg = "Invalid Method";																				
									resJson(res, out);																				
								}							
								break;
							case 'terminate':
								if ( method==='POST' ){
								
								}else{
									out.msg = "Invalid Method";																				
									resJson(res, out);																				
								}							
								break;							
							case 'status':
								if ( method==='GET' ){
								
								}else{
									out.msg = "Invalid Method";																				
									resJson(res, out);																				
								}														
								break;
							case 'delete':
								if ( method==='DELETE' ){
								
								}else{
									out.msg = "Invalid Method";																				
									resJson(res, out);																				
								}																					
								break;
							default:
								if ( method==='GET' ){
									localPool.exec('select * from sessions where status<>? and deleted_at=? order by uid desc limit ?', ['finalized', 0, 1],
										function(err, sRec){
											if ( err ){
												console.log(err);
												resJson(res, {status:false, msg:'Failed to query active session'});
											}else{
												out.status = true;
												out.msg = (sRec.length===1)?"Active session found":"No active sessions";
												out.session = (sRec.length===1)?sRec[0]:null;
												resJson(res, out);
											}
										}		
									);																															
								}else{
									out.msg = "Invalid Method";																				
									resJson(res, out);																				
								}																												
						}
						break;
					case 'queue':
						var sessionID = tokens.shift();
						if ( isNaN(parseInt(sessionID, 10)) ){
							out.msg = "Must specify sessionID";																				
							resJson(res, out);																												
						}else{	
							var nextToken = tokens.shift();
							switch(nextToken){
								case 'mute':
									sendData(
										'mute',
										function(feedBack){
											resJson(res, feedBack);															
										}
									);
									break;
								case 'unmute':
									sendData(
										'unmute',
										function(feedBack){
											resJson(res, feedBack);															
										}
									);
									break;
								case 'vinc':
									sendData(
										'vinc',
										function(feedBack){
											resJson(res, feedBack);															
										}
									);
									break;
								case 'vdec':
									sendData(
										'vdec',
										function(feedBack){
											resJson(res, feedBack);															
										}
									);
									break;
								case 'status':
									sendData(
										'status',
										function(feedBack){
											resJson(res, feedBack);															
										}
									);
									break;	
								case 'set':									
									localPool.exec('select * from playback_queue where sessionID=? and status<>? order by orderID asc', [sessionID, 'done'],
										function(err, qRec){
											if ( err ){
												console.log(err);
												resJson(res, {status:false, msg:'Failed to query session playback queue'});
											}else{
												if ( qRec.length > 0 ){
													var dataOut = "queue ";
													if ( qRec[0].mediaSource.indexOf('http://') > -1 ){
														dataOut+= qRec[0].mediaSource;
													}else{
														if ( qRec[0].isEventFeed ){
															dataOut+= ' http://localhost:8080'+qRec[0].mediaSource;
															if ( qRec[0].startPos > 0 ){
																dataOut+= ' '+qRec[0].startPos;
															}
														}else{	
															dataOut+= ' /home/assets/'+qRec[0].mediaSource;
														}
													}				
													console.log(dataOut);
													sendData(
														dataOut,
														function(feedBack){
															resJson(res, feedBack);															
														}
													);
												}else{
													resJson(res, {status:false, msg:'Nothing to play'});												
												}
											}
										}
									);
									break;										
								case 'play':
									localPool.exec('select * from playback_queue where sessionID=? and status<>? order by orderID asc', [sessionID, 'done'],
										function(err, qRec){
											if ( err ){
												console.log(err);
												resJson(res, {status:false, msg:'Failed to query session playback queue'});
											}else{
												if ( qRec.length > 0 ){
													sendData(
														'play',
														function(feedBack){
															if ( feedBack.status ){
																localPool.exec('update playback_queue set status=? where uid=?', ['playing', qRec[0].uid],
																	function(err, qRec){
																		if ( err ){
																			console.log(err);
																		}
																		resJson(res, {status:true, msg:'Playing'});
																	}
																);
															}else{
																resJson(res, feedBack);															
															}
														}
													);
												}else{
													out.msg = 'Nothing to play';
													resJson(res, out);
												}
											}
										}		
									);									
									break;
								case 'pause':
									localPool.exec('select * from playback_queue where sessionID=? and status<>? order by orderID asc', [sessionID, 'done'],
										function(err, qRec){
											if ( err ){
												console.log(err);
												resJson(res, {status:false, msg:'Failed to query session playback queue'});
											}else{
												if ( qRec.length > 0 ){
													sendData(
														'pause',
														function(feedBack){
															if ( feedBack.status ){
																localPool.exec('update playback_queue set status=? where uid=?', ['paused', qRec[0].uid],
																	function(err, qRec){
																		if ( err ){
																			console.log(err);
																		}
																		resJson(res, {status:true, msg:'Paused'});
																	}
																);
															}else{
																resJson(res, feedBack);															
															}
														}
													);
												}else{
													out.msg = 'Nothing to pause';
													resJson(res, out);
												}
											}
										}		
									);								
									break;
								case 'terminate':
									break;
								default:
									if ( nextToken != undefined ){
										tokens.unshift(nextToken);
									}
									switch(method){
										case 'GET':
											localPool.exec('select * from playback_queue where sessionID=? order by orderID asc', [sessionID],
												function(err, sRec){
													if ( err ){
														console.log(err);
														resJson(res, {status:false, msg:'Failed to query session playback queue'});
													}else{
														out.status = true;
														out.msg   = sRec.length+" entries queued for playback";
														out.queue = sRec;
														resJson(res, out);
													}
												}		
											);
											break;
										case 'POST':
											req.parsePostData(
												function(err, fields){
													if (err){
														out.msg = "Missing request data";																				
														resJson(res, out);											
													}else{								
														localPool.exec('update playback_queue set ? where uid='+tokens.shift(), [fields],
															function(err, updateRec){
																if ( err ){
																	console.log(err);
																	resJson(res, {status:false, msg:'Failed to update playback queue entry'});
																}else{
																	out.status = true;
																	out.msg   = "Update queue entry has been updated";
																	resJson(res, out);
																}
															}		
														);			
													}
												}
											);								
											break;
										case 'PUT':
											req.parsePostData(
												function(err, fields){
													if (err){
														out.msg = "Missing request data";																				
														resJson(res, out);											
													}else{
														localPool.exec('select orderID from playback_queue where sessionID=? order by orderID desc limit 1', [sessionID],
															function(err, lookupRes){
																if ( err ){
																	console.log(err);
																	resJson(res, {status:false, msg:'Failed to query playback queue'});
																}else{														
																	var queueItem = {
																		sessionID: sessionID,
																		orderID: (lookupRes.length>0)?1+lookupRes[0].orderID:1,
																		mediaSource: fields.mediaSource,
																		startPos: fields.startPos,
																		duration: fields.duration
																	};
																	
																	localPool.exec('insert into playback_queue set ?', queueItem,
																		function(err, insRes){
																			if ( err || insRes.affectedRows===0 ){
																				console.log(err);
																				resJson(res, {status:false, msg:'Failed to add enry to playback queue'});
																			}else{
																				out.status = true;
																				out.msg   = "Entry added to playback queue";
																				resJson(res, out);
																			}
																		}		
																	);
																}
															}		
														);												
													}
												}
											);
											break;
										case 'DELETE':
											var queueEntryID = tokens.shift();
											if ( isNaN(parseInt(queueEntryID, 10)) ){
												out.msg = "Must specify queue entry ID";																				
												resJson(res, out);																												
											}else{					
												localPool.exec('delete from playback_queue where sessionID=? and uid=?', [sessionID, queueEntryID],
													function(err, delRes){
														if ( err || delRes.affectedRows===0 ){
															console.log(err);
															resJson(res, {status:false, msg:'Failed to remove enry from playback queue'});
														}else{
															out.status = true;
															out.msg   = "Entry has been removed from playback queue";
															resJson(res, out);
														}
													}		
												);								
											}
										default:
											out.msg = "Invalid Method";																				
											resJson(res, out);																				
									}
									break;
							}
						}
						break;						
					case 'buffer':
						serveStatic('/home/buffer/'+tokens.join('/'), res);							
						break;						
					case 'static':
						serveStatic(req.pathName(), res);
						break;
					case 'index.html': case '':
						serveStatic('static/views/interface.html', res);
						break;
					default:
						if ( extension === '.html' ){
							serveStatic('static/views/'+pathname, res);
						}else{
							res404(res);
						}
						break;		
				}
			}else{
				switch(tokens.shift()){
					case 'buffer':
						serveStatic('/home/buffer/'+tokens.join('/'), res);							
						break;
					case 'static':
						serveStatic(req.pathName(), res);
						break;
					case '':
						switch(method){
							case 'GET':
								console.log('Show RMSS License Dialog');
								serveStatic('static/views/license.html', res);			
								break;
							case 'POST':
								req.parsePostData(
									function(err, fields){
										if ( err ){
											resJson(res, {status:false, msg:'Must Post License Key'});
										}else{
											if ( fields.region && fields.licenseKey ){
												var rmss = new RmssClient({region:fields.region});
												rmss.post('activate', {mac_addr_hash:hash, activation_key:fields.licenseKey}, 
													function(err, httpCode, data){
														if ( err ){
															console.log(err);		
															resJson(res, {status:false, msg:'Activation Failed'});
														}else{
															if ( httpCode === 200 ){
																if ( data.error ){
																	resJson(res, {status:false, msg:data.error.message});
																}else{
																	var insRec = {'license_key':fields.licenseKey, 'rmss_region':fields.region, 'license_status':1, 'activated_at':now, 'lastlookup_at':now };
																	localPool.exec('insert into license_info set ?', insRec,
																		function(err, recSet){
																			if ( err ){
																				resJson(res, {status:false, msg:'Failed to create license record'});
																			}else{
																				insRec.uid = recSet.insertId;
																				licenseInfo = insRec;
																				resJson(res, {status:true, msg:'Your device has been activated'});
																			}
																		}		
																	);															
																}
															}else{
																resJson(res, {status:false, msg:'Failed to access activation service'});
															}
														}
													}
												);
											}else{
												resJson(res, {status:false, msg:'Malformed License Key'});
											}
										}
									}
								);
								break;
							default:
								res404(res);		
						}
						break;
					default:
						res404(res);
				}
			}
		}
	);
}
http.createServer(onRequest).listen(8080);

/*
var rmss = new RmssClient({region:'JFK'});
rmss.post('log/clientstatus', {clientVersion:'NUC.Mk0', diskSpace:'428', mac_addr_hash:hash}, 
	function(err, httpCode, data){
		if ( err ){
			console.log(err);		
		}else{
			console.log(data);
		}
	}
);
*/
