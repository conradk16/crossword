import sys, os, re, paramiko, io
from pathlib import Path
from scp import SCPClient

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

# copies docker-compose.yml from the current directory to ec2, substituting in replacements
# replacements (dict): Dictionary of {key: value} to replace {{key}} in file.
def copy_docker_compose(ssh_connection, docker_compose_filepath, replacements):
    print("Copying docker-compose to ec2...")

    with open(docker_compose_filepath, "r") as f:
        contents = f.read()

    for key, value in replacements.items():
        pattern = r"\{\{\s*" + re.escape(key) + r"\s*\}\}"
        contents = re.sub(pattern, str(value), contents)

    temp_filepath = "/tmp/docker-compose.yml"
    with open(temp_filepath, "w") as f:
        f.write(contents)

    # Copy file to EC2
    remote_file = "/home/ec2-user/docker-compose.yml"
    with SCPClient(ssh_connection.get_transport()) as scp:
        scp.put(temp_filepath, remote_file)

def run_remote_command(ssh_connection, command):
    print(f"Running command {command} on ec2...")
    _, stdout, stderr = ssh_connection.exec_command(command)
    exit_status = stdout.channel.recv_exit_status()
    if exit_status == 0:
        print(stdout.read().decode())
    else:
        print(stderr.read().decode())
        raise Exception(f"Command failed: {command}")

def deploy(ip, docker_compose_replacements):
    docker_compose_filepath = str(Path(__file__).resolve().parent) + '/docker-compose.yml'

    ssh_connection = get_ssh_connection(ip)
    copy_docker_compose(ssh_connection, docker_compose_filepath, docker_compose_replacements)

    run_remote_command(ssh_connection, "docker-compose down")
    run_remote_command(ssh_connection, "docker-compose up -d")
    run_remote_command(ssh_connection, "docker image prune -a --force")
    run_remote_command(ssh_connection, "docker volume prune --force")

    ssh_connection.close()
    
if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ['dev', 'prod']:
        print('usage: python3 deploy.py <dev/prod> <7_char_commit_sha>')
        quit()
    print(f'Deploying {sys.argv[1]}')
    docker_compose_replacements = {'tier' : sys.argv[1], 'sha' : sys.argv[2]}
    ec2_ip = '98.82.151.44' if sys.argv[1] == 'prod' else '34.218.130.248'
    deploy(ec2_ip, docker_compose_replacements)