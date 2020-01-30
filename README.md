[![npm version](https://badge.fury.io/js/arssh2-client.svg)](https://badge.fury.io/js/arssh2-client)
[![Build Status](https://travis-ci.org/so5/arssh2-client.svg?branch=master)](https://travis-ci.org/so5/arssh2-client)
[![Coverage Status](https://coveralls.io/repos/github/so5/arssh2-client/badge.svg?branch=master)](https://coveralls.io/github/so5/arssh2-client?branch=master)
[![Maintainability](https://api.codeclimate.com/v1/badges/fa854220ce9d6b122add/maintainability)](https://codeclimate.com/github/so5/arssh2-client/maintainability)
[![Inline docs](http://inch-ci.org/github/so5/arssh2-client.svg?branch=master)](http://inch-ci.org/github/so5/arssh2-client)
[![Greenkeeper badge](https://badges.greenkeeper.io/so5/arssh2-client.svg)](https://greenkeeper.io/)


# README #

arssh2-client is auto recovery ssh client wrapper for ssh2(https://github.com/mscdex/ssh2)

# features
- ES6 Promise based functions
- auto-reconnect and retry if connection is unavailable
- some usefull high-level functions e.g. scp -r, mkdir -p, watch
- support multiple connection
- support glob for file transfer functions

# API
plase check separate docment(./API.md)

# verbose log
arssh2-client use debug module to write all debug output.
you can enable all debug output to set DEBUG environment variable as follows

```
#"app.js" is your app using arssh2-licent library

#for Linux,mac
DEBUG=arssh2* node app.js
#for windows power shell
$env:DEBUG='arssh2*';node app.js
```

available namespace is as follows
- arssh2:arssh2
- arssh2:jobs
- arssh2:connection-manager
- arssh2:sftpUtil
- arssh2:sshExec

and following namespace is used underlying libraries
- arssh2:ssh2
- sbs:sbs
