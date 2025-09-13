import os
import paramiko
from scp import SCPClient

def get_ssh_connection():
    key_path = os.getenv("EC2_KEY_PATH")
    if not key_path:
        raise RuntimeError("EC2_KEY_PATH environment variable is not set.")

    hostname = "98.82.151.44"
    username = "ec2-user"

    key = paramiko.RSAKey.from_private_key_file(key_path)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(hostname=hostname, username=username, pkey=key)
    return ssh

def copy_docker_compose(ssh):
    local_file = "docker-compose.yml"
    remote_file = "/home/ec2-user/docker-compose.yml"
    with SCPClient(ssh.get_transport()) as scp:
        scp.put(local_file, remote_file)

if __name__ == '__main__':
    ssh = get_ssh_connection()
    copy_docker_compose(ssh)
    ssh.close()