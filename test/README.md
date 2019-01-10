# environment variables for ssh login

- ARSSH\_TEST\_HOSTNAME
hostname to be accessed (localhost by default)

- ARSSH\_TEST\_USER 
username on ssh server (same with the user who invoke tests)

- ARSSH\_TEST\_PORT 
port number (22)

- ARSSH\_TEST\_KEYFILE
private key filename

- ARSSH\_TEST\_PW
password  or passphrase if ARSSH\_TEST\_KEYFILE is not set, this variable will be use as password, otherwise it will use as passpharase for private key
