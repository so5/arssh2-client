var express = require('express');
var path = require('path');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');

var main = require('./routes/main.js');

var app = express();

app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());

app.use(express.static('public'));
app.use('/', main);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  res.sendFile(path.resolve("public/not_found.html"));
});

// error handler
app.use(function(err, req, res, next) {
  console.log(err)

  // render the error page
  res.status(err.status || 500);
  res.send('something broke!');
});

module.exports = app;
