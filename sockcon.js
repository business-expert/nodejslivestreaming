const net = require('net');

function sendData(data){
	var client = net.createConnection("/home/domsocks/daemonsock");
	//var client = net.createConnection("/usr/local/src/ffplayClone/echo_socket");
	client
		.on("connect", 
			function(){
				console.log('connected');
				//client.write("Hello\r\n");
			}
		)
		.on("data", 	
			function(data){
				console.log(data.toString());
				client.end();
			}
		)
		.on("error", 	
			function(ex){
				console.log(ex);
			}
		)
		client.on('end', 
			function(){
				console.log('disconnected from server');
			}
		)
	;
	client.write(data, 
		function(err){ 
			//client.end();
			//sendData('12345');
		}
	);
}
var cmdObj = {cmd:'session.start', sessionID:5, sessionName:'2016_11_02_22_43_08', renditionUri:'http://pageantvision-lh.akamaihd.net/i/pageantVision149_1@181769/index_800_av-p.m3u8?sd=10&rebase=on'};
sendData(JSON.stringify(cmdObj)+'\r\l');

