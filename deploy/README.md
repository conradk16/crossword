## First-time setup

To get started, first start a python environment with `python3 -m venv .venv` and `source .venv/bin/activate`. 
Install requirements with `pip3 install -r requirements.txt`.

## Deployment

Find a commit sha in github with a successful github actions run. Then run `python3 deploy.py <sha>`. This will deploy nginx and nextjs to the prod ec2 instance. 