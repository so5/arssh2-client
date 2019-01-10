FROM centos:centos7
EXPOSE 22

# install sshd package
RUN yum -y install openssh-server initscripts

# generate hostkey
RUN /usr/sbin/sshd-keygen

# add non-root user and set password
RUN adduser testuser && echo "passw0rd" | passwd --stdin testuser
RUN mkdir -p /home/testuser/.ssh && chown testuser:testuser  /home/testuser/.ssh

CMD ["/usr/sbin/sshd", "-D"]
