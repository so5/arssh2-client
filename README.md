# DEPRECATED
This library is no longer supported.

I made a brand-new library called ssh-client-wrapper. It uses underlying openssh and rsync command instead of mscdex/ssh2.
So, it's file transfer performance is greately improved. and you can use ssh-agenat, ssh_config, agent-forward without effort.

If you are interested please take a look

https://github.com/so5/ssh-client-wrapper

https://www.npmjs.com/package/ssh-client-wrapper




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
