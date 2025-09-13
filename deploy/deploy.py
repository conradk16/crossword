import sys, os, re, paramiko, io
from pathlib import Path
from scp import SCPClient

def update_docker_compose_with_sha(docker_compose_filepath, sha):
    print("Updating local docker compose with sha...")
    with open(docker_compose_filepath, 'r') as docker_compose_file:
        docker_compose_content = docker_compose_file.read()
    
    # Replace anything that matches r':[a-f0-9]{7}' with the new sha
    updated_docker_compose_content = re.sub(r':[a-f0-9]{7}', ":" + sha, docker_compose_content)

    with open(docker_compose_filepath, 'w') as file:
        file.write(updated_docker_compose_content)

def get_ssh_connection(ip):
    key_path = os.getenv("EC2_KEY_PATH")
    if not key_path:
        raise RuntimeError("EC2_KEY_PATH environment variable is not set.")

    username = "ec2-user"

    key = paramiko.RSAKey.from_private_key_file(key_path)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(hostname=ip, username=username, pkey=key)
    return ssh

# copies docker-compose.yml from the current directory to ec2
def copy_docker_compose(ssh_connection, docker_compose_filepath):
    print("Copying docker-compose to ec2...")
    local_file = docker_compose_filepath.split('/')[-1]
    remote_file = "/home/ec2-user/docker-compose.yml"
    with SCPClient(ssh_connection.get_transport()) as scp:
        scp.put(local_file, remote_file)

def run_remote_command(ssh_connection, command):
    print(f"Running command {command} on ec2...")
    _, stdout, stderr = ssh_connection.exec_command(command)
    exit_status = stdout.channel.recv_exit_status()
    if exit_status == 0:
        print(stdout.read().decode())
    else:
        print(stderr.read().decode())
        raise Exception(f"Command failed: {command}")

def deploy(sha, ip, docker_compose_filepath):
    update_docker_compose_with_sha(docker_compose_filepath, sha)

    ssh_connection = get_ssh_connection(ip)
    copy_docker_compose(ssh_connection, docker_compose_filepath)

    run_remote_command(ssh_connection, "docker-compose down")
    run_remote_command(ssh_connection, "docker-compose up -d")
    run_remote_command(ssh_connection, "docker image prune -a --force")
    run_remote_command(ssh_connection, "docker volume prune --force")

    ssh_connection.close()
    
if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ['dev', 'prod']:
        print('usage: python3 deploy.py <dev/prod> <7_char_commit_sha>')
        quit()
    print(f'deploying {sys.argv[1]}')
    ec2_ip = '98.82.151.44' if sys.argv[1] == 'prod' else '54.158.16.33'
    parent_filepath = str(Path(__file__).resolve().parent)
    docker_compose_filepath = parent_filepath + f'/docker-compose-{sys.argv[1]}.yml'
    deploy(sys.argv[2], ec2_ip, docker_compose_filepath)