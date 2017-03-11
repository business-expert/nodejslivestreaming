"use strict"
//-----------------------------------------------------------------------------
var fork    = require('child_process').fork;

//daemon-----------------------------------------------------------------------
var loader = fork('./loader.js');
loader
	.on('exit', 
		function(code){
			console.log('worker exit '+code);
		}		
	)

	.on('exit', 
		function(code){
			console.log('worker exit '+code);
		}		
	)
	
	.stdout.on('data',
		function(data){
			console.log('stdout>>'+data);
		}
	)
	
	.stdout.on('data',
		function(data){
			console.log('stdout>>'+data);
		}
	)
