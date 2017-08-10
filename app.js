var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');

var main = require('./routes/main.js');

var app = express();

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());

app.use('/', main);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  res.sendFile(path.resolve("views/not_found.html"));
});

// error handler
app.use(function(err, req, res, next) {
  console.log(err)

  // render the error page
  res.status(err.status || 500);
  res.send('something broke!');
});

module.exports = app;
