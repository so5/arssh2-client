$(function () {
  var socket=io();
  //ssh_stdoutなどのハンドラはsocket.ioのnamespaceで置き換えること
  socket.on('ssh_stdout', function(msg){
    $("#output").append(msg.toString()+'\n');
    $("#output").scrollTop($("#output")[0].scrollHeight);
  });
  socket.on('ssh_stderr', function(msg){
    $("#output").append(msg.toString()+'\n');
    $("#output").scrollTop($("#output")[0].scrollHeight);
  });
  $('form').submit(function(){
    socket.emit('cmd', $('#cmd').val());
    $('#cmd').val('');
    return false;
  });
});

