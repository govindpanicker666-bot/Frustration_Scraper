"""Extract full public LinkedIn posts from post URLs using ToolzerHub's parser."""
import argparse
import json
import os
from linkedin_scraper import LinkedIn


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("urls", nargs="+")
    args = parser.parse_args()
    client = LinkedIn(proxy=os.environ.get("HTTPS_PROXY"))
    posts, errors = [], []
    try:
        for url in args.urls:
            try:
                post = client.post(url)
                if post and post.get("text"):
                    posts.append(post)
                else:
                    errors.append({"url": url, "error": "Public post page did not expose post text."})
            except Exception as exc:
                errors.append({"url": url, "error": str(exc)[:300]})
    finally:
        try:
            client.http.close()
        except Exception:
            pass
    print(json.dumps({"posts": posts, "errors": errors}, ensure_ascii=False))


if __name__ == "__main__":
    main()
