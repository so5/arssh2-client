[![npm version](https://badge.fury.io/js/arssh2-client.svg)](https://badge.fury.io/js/arssh2-client)
[![Build Status](https://travis-ci.org/so5/arssh2-client.svg?branch=master)](https://travis-ci.org/so5/arssh2-client)
[![Coverage Status](https://coveralls.io/repos/github/so5/arssh2-client/badge.svg?branch=master)](https://coveralls.io/github/so5/arssh2-client?branch=master)
[![Maintainability](https://api.codeclimate.com/v1/badges/fa854220ce9d6b122add/maintainability)](https://codeclimate.com/github/so5/arssh2-client/maintainability)
[![Inline docs](http://inch-ci.org/github/so5/arssh2-client.svg?branch=master)](http://inch-ci.org/github/so5/arssh2-client)


# README #

arssh2-client is auto recovery ssh client wrapper for ssh2(https://github.com/mscdex/ssh2)

# features
- auto-reconnect and retry if connection is unavailable
- recursive file transfer (like scp -r)
- ES6 Promise based functions

# methods
## ARsshClient
arssh2 facade class

**Kind**: global class

* [ARsshClient](#ARsshClient)
    * [new ARsshClient([config], [opt])](#new_ARsshClient_new)
    * [.exec(cmd, [opt])](#ARsshClient+exec)
    * [.send(src, dst)](#ARsshClient+send)
    * [.recv(src, dst)](#ARsshClient+recv)
    * [.ls(target)](#ARsshClient+ls)
    * [.mkdir_p(target)](#ARsshClient+mkdir_p)
    * [.realpath(target)](#ARsshClient+realpath)
    * [.changeConfig(property, value)](#ARsshClient+changeConfig)
    * [.overwriteConfig(config)](#ARsshClient+overwriteConfig)
    * [.canConnect()](#ARsshClient+canConnect)
    * [.disconnect()](#ARsshClient+disconnect)

<a name="new_ARsshClient_new"></a>

### new ARsshClient([config], [opt])
constructor


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [config] | <code>object</code> |  | ssh2's connection setting |
| [opt] | <code>object</code> |  | arssh2's own option object |
| [opt.delay] | <code>string</code> | <code>1000</code> | delay between each cmd execution |
| [opt.connectionRetry] | <code>string</code> | <code>5</code> | max number of retry connection |
| [opt.connectionRetryDelay] | <code>string</code> | <code>1000</code> | delay between each connection try (msec) |
| [opt.maxConnection] | <code>string</code> | <code>4</code> | max number of parallel connection |
| [opt.delay] | <code>string</code> | <code>1000</code> | delay between each cmd execution (msec) please note you can pass any other original ssh2's option by config object |

<a name="ARsshClient+exec"></a>

### ARsshClient.exec(cmd, [opt])
execute command on remote host

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| cmd | <code>string</code> |  | cmdline which will be executed |
| [opt] | <code>object</code> | <code>{}</code> | ssh2's exec option object |

<a name="ARsshClient+send"></a>

### ARsshClient.send(src, dst)
send file or directory and its child to server

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)

| Param | Type | Description |
| --- | --- | --- |
| src | <code>string</code> | file or directory name which to be send |
| dst | <code>string</code> | destination path |

<a name="ARsshClient+recv"></a>

### ARsshClient.recv(src, dst)
get file or directory and its child from server

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)

| Param | Type | Description |
| --- | --- | --- |
| src | <code>string</code> | file or directory name which to be retrieve |
| dst | <code>string</code> | destination path |

<a name="ARsshClient+ls"></a>

### ARsshClient.ls(target)
list files and directories on remote host

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)

| Param | Type | Description |
| --- | --- | --- |
| target | <code>string</code> | target path |

<a name="ARsshClient+mkdir_p"></a>

### ARsshClient.mkdir_p(target)
recursively make directory on remote host (like mkdir -p)

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)

| Param | Type | Description |
| --- | --- | --- |
| target | <code>string</code> | target path |

<a name="ARsshClient+realpath"></a>

### ARsshClient.realpath(target)
get absolute path on remote host

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)

| Param | Type | Description |
| --- | --- | --- |
| target | <code>string</code> | target path |

<a name="ARsshClient+changeConfig"></a>

### ARsshClient.changeConfig(property, value)
setter for arssh2's option and ssh2's config

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)

| Param | Type | Description |
| --- | --- | --- |
| property | <code>string</code> | property which will be changed |
| value | <code>string</code> | new value |

<a name="ARsshClient+overwriteConfig"></a>

### ARsshClient.overwriteConfig(config)
rewrite whole member of ssh2

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)

| Param | Type | Description |
| --- | --- | --- |
| config | <code>Object</code> | config object which will be passed to ssh2.connect |

<a name="ARsshClient+canConnect"></a>

### ARsshClient.canConnect()
check if you can connect to specified server

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)
<a name="ARsshClient+disconnect"></a>

### ARsshClient.disconnect()
disconnect all existing connections

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)
