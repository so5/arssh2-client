## Classes

<dl>
<dt><a href="#ARsshClient">ARsshClient</a></dt>
<dd><p>Facade class</p>
</dd>
</dl>

## Typedefs

<dl>
<dt><a href="#Integer">Integer</a> : <code>Object</code></dt>
<dd><p>Integer means integer number but it is defined as Object for now
workaround for eslint-plugin-jsdoc&#39;s no-undefined-types rule bug</p>
</dd>
</dl>

<a name="ARsshClient"></a>

## ARsshClient
Facade class

**Kind**: global class  

* [ARsshClient](#ARsshClient)
    * [new ARsshClient(config, opt)](#new_ARsshClient_new)
    * [.exec(cmd, argOpt, stdout, stderr)](#ARsshClient+exec) ⇒ [<code>Integer</code>](#Integer)
    * [.watch(cmd, regexp, retryDelay, maxRetry, argOpt, stdout, stderr)](#ARsshClient+watch) ⇒ [<code>Integer</code>](#Integer)
    * [.send(src, dst, only, exclude, opt)](#ARsshClient+send) ⇒ <code>Promise</code>
    * [.recv(src, dst, only, exclude, opt)](#ARsshClient+recv) ⇒ <code>Promise</code>
    * [.mkdir_p(target)](#ARsshClient+mkdir_p) ⇒ <code>Promise</code>
    * [.rm_rf(target)](#ARsshClient+rm_rf) ⇒ <code>Promise</code>
    * [.realpath(target)](#ARsshClient+realpath) ⇒ <code>string</code>
    * [.rm(target)](#ARsshClient+rm) ⇒ <code>Promise</code>
    * [.ls(target)](#ARsshClient+ls) ⇒ <code>Array.&lt;Promise&gt;</code>
    * [.chmod(target, mode)](#ARsshClient+chmod) ⇒ <code>Promise</code>
    * [.chown(target, uid, gid)](#ARsshClient+chown) ⇒ <code>Promise</code>
    * [.changeConfig(key, value)](#ARsshClient+changeConfig)
    * [.overwriteConfig(config)](#ARsshClient+overwriteConfig)
    * [.canConnect()](#ARsshClient+canConnect) ⇒ <code>Promise</code>
    * [.disconnect()](#ARsshClient+disconnect)

<a name="new_ARsshClient_new"></a>

### new ARsshClient(config, opt)
Constructor function.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| config | <code>Object</code> |  | Ssh2's connection setting. |
| opt | <code>Object</code> |  | Arssh2's own option object. |
| opt.connectionRetry | [<code>Integer</code>](#Integer) | <code>5</code> | Max number of retry connection. |
| opt.connectionRetryDelay | [<code>Integer</code>](#Integer) | <code>1000</code> | Delay between each connection try (msec). |
| opt.maxConnection | [<code>Integer</code>](#Integer) | <code>4</code> | Max number of parallel connection. |
| opt.renewInterval | [<code>Integer</code>](#Integer) | <code>0</code> | Connection renewal interval (msec). |
| opt.renewDelay | [<code>Integer</code>](#Integer) | <code>0</code> | Reconnection delay when renewal event occurred (msec). |
| opt.debug | <code>function</code> |  | Debug output function. |

<a name="ARsshClient+exec"></a>

### aRsshClient.exec(cmd, argOpt, stdout, stderr) ⇒ [<code>Integer</code>](#Integer)
Execute command on remote host.

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)  
**Returns**: [<code>Integer</code>](#Integer) - - Return code of cmd.

if stdout and stderr is array, last 10 line of stdout and stderr is stored in them.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| cmd | <code>string</code> |  | Cmdline which will be executed. |
| argOpt | <code>Object</code> |  | Ssh2's exec option object. |
| stdout | <code>Array.&lt;string&gt;</code> \| <code>function</code> | <code></code> | Array to be stored stdout or call back function for stdout. |
| stderr | <code>Array.&lt;string&gt;</code> \| <code>function</code> | <code></code> | Array to be stored stderr or call back function for stderr. |

<a name="ARsshClient+watch"></a>

### aRsshClient.watch(cmd, regexp, retryDelay, maxRetry, argOpt, stdout, stderr) ⇒ [<code>Integer</code>](#Integer)
Execute command repeatedly until specified keyword is found in stdout and/or stderr.

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)  
**Returns**: [<code>Integer</code>](#Integer) - - Return code of cmd.

if stdout and stderr is array, last 10 line of stdout and stderr is stored in them.  

| Param | Type | Description |
| --- | --- | --- |
| cmd | <code>string</code> | Cmdline which will be executed. |
| regexp | <code>Object</code> \| <code>RegExp</code> | End condition. |
| regexp.out | <code>RegExp</code> | Regexp only for stdout. |
| regexp.err | <code>RegExp</code> | Regexp only for stderr. |
| retryDelay | <code>number</code> | Duration between each try (in msec). |
| maxRetry | <code>number</code> | Max retry count. |
| argOpt | <code>Object</code> | Ssh2's exec option object. |
| stdout | <code>Array.&lt;string&gt;</code> \| <code>function</code> | Array to be stored stdout or call back function for stdout. |
| stderr | <code>Array.&lt;string&gt;</code> \| <code>function</code> | Array to be stored stderr or call back function for stderr. |

<a name="ARsshClient+send"></a>

### aRsshClient.send(src, dst, only, exclude, opt) ⇒ <code>Promise</code>
Send file or directory and its child to server.

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)  
**Returns**: <code>Promise</code> - - Resolved with undefined when file transfer is done.  

| Param | Type | Description |
| --- | --- | --- |
| src | <code>string</code> | File or directory name which to be send. |
| dst | <code>string</code> | Destination path. |
| only | <code>string</code> | Only matched file will be transferd. |
| exclude | <code>string</code> | Matched file never transferd even it match only filter. |
| opt | <code>Object</code> | Option object to ssh2's fastget. |

<a name="ARsshClient+recv"></a>

### aRsshClient.recv(src, dst, only, exclude, opt) ⇒ <code>Promise</code>
Get file or directory and its child from server.

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)  
**Returns**: <code>Promise</code> - - Resolved with undefined when file transfer is done.  

| Param | Type | Description |
| --- | --- | --- |
| src | <code>string</code> | File or directory name which to be recieve. |
| dst | <code>string</code> | Destination path. |
| only | <code>string</code> | Only matched file will be transferd. |
| exclude | <code>string</code> | Matched file never transferd even it match only filter. |
| opt | <code>Object</code> | Option object to ssh2's fastget. |

<a name="ARsshClient+mkdir_p"></a>

### aRsshClient.mkdir\_p(target) ⇒ <code>Promise</code>
Recursively make directory on remote host (like mkdir -p).

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)  
**Returns**: <code>Promise</code> - - Resolved with undefined when file transfer is done.  

| Param | Type | Description |
| --- | --- | --- |
| target | <code>string</code> | Target path. |

<a name="ARsshClient+rm_rf"></a>

### aRsshClient.rm\_rf(target) ⇒ <code>Promise</code>
Recursively remove file and directoies on remote host (like rm -rf).

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)  
**Returns**: <code>Promise</code> - - Resolved with undefined when file transfer is done.  

| Param | Type | Description |
| --- | --- | --- |
| target | <code>string</code> | Target path. |

<a name="ARsshClient+realpath"></a>

### aRsshClient.realpath(target) ⇒ <code>string</code>
Get absolute path on remote host.

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)  
**Returns**: <code>string</code> - - Absolute path of target on remote server.  

| Param | Type | Description |
| --- | --- | --- |
| target | <code>string</code> | Target path. |

<a name="ARsshClient+rm"></a>

### aRsshClient.rm(target) ⇒ <code>Promise</code>
Remove single file.

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)  
**Returns**: <code>Promise</code> - - Fullfilled when rm is done on remote server.  

| Param | Type | Description |
| --- | --- | --- |
| target | <code>string</code> | Target path. |

<a name="ARsshClient+ls"></a>

### aRsshClient.ls(target) ⇒ <code>Array.&lt;Promise&gt;</code>
List files and directories on remote host.

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)  
**Returns**: <code>Array.&lt;Promise&gt;</code> - - Resolved with array of filenames.  

| Param | Type | Description |
| --- | --- | --- |
| target | <code>string</code> | Target path. |

<a name="ARsshClient+chmod"></a>

### aRsshClient.chmod(target, mode) ⇒ <code>Promise</code>
Change file mode on remote host.

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)  
**Returns**: <code>Promise</code> - - Resolved with undefined when chmod is done.  

| Param | Type | Description |
| --- | --- | --- |
| target | <code>string</code> | Target path. |
| mode | <code>string</code> | Desired file mode. |

<a name="ARsshClient+chown"></a>

### aRsshClient.chown(target, uid, gid) ⇒ <code>Promise</code>
Change file owner on remote host.

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)  
**Returns**: <code>Promise</code> - - Resolved with undefined when chown is done.  

| Param | Type | Description |
| --- | --- | --- |
| target | <code>string</code> | Target path. |
| uid | [<code>Integer</code>](#Integer) | Desired user id. |
| gid | [<code>Integer</code>](#Integer) | Desired group id. |

<a name="ARsshClient+changeConfig"></a>

### aRsshClient.changeConfig(key, value)
Setter for arssh2's option and ssh2's config.

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>string</code> | Property name which will be changed. |
| value | <code>string</code> | New value. |

<a name="ARsshClient+overwriteConfig"></a>

### aRsshClient.overwriteConfig(config)
Rewrite whole member of ssh2's config.

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)  

| Param | Type | Description |
| --- | --- | --- |
| config | <code>Object</code> | Config object which will be passed to ssh2.connect. |

<a name="ARsshClient+canConnect"></a>

### aRsshClient.canConnect() ⇒ <code>Promise</code>
Check if you can connect to specified server.

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)  
**Returns**: <code>Promise</code> - - Resolved with true on success, otherwise rejected with Error.  
<a name="ARsshClient+disconnect"></a>

### aRsshClient.disconnect()
Disconnect all existing connections.

**Kind**: instance method of [<code>ARsshClient</code>](#ARsshClient)  
<a name="Integer"></a>

## Integer : <code>Object</code>
Integer means integer number but it is defined as Object for now
workaround for eslint-plugin-jsdoc's no-undefined-types rule bug

**Kind**: global typedef  
