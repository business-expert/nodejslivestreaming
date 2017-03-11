const spawn = require('child_process').spawn;
const ls = spawn('ffplay', ['-fs', '-ss', '00:30:30', 'http://104.236.83.163:8080/i/terminator_genisys/index.m3u8']);

ls.stdout.on('data', function(data){
  console.log('stdout:'+data);
});

ls.stderr.on('data', function(data){
  console.log('stderr:'+data);
});

ls.on('close', function(code){
  console.log('child process exited with code:'+ code);
});