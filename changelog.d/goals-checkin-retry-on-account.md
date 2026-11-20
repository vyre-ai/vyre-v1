A goal check-in that failed because the server stopped or no AI account existed yet is asked again at once when an AI account is saved, and otherwise on the bounded backoff, once and never in a loop.
