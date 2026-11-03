import os
from fastapi import FastAPI

app = FastAPI()


@app.get("/")
def root():
    return {"fastapi": "fastapi-fixture-ok", "greeting": os.environ.get("GREETING")}
