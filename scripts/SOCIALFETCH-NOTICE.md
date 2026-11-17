# SocialFetch vendor notice

This repository vendors the SocialFetch CLI from:

- Upstream: https://github.com/EdgeAIG/socialfetch
- Upstream version: 1.6.0
- License: MIT (see [SOCIALFETCH-LICENSE](./SOCIALFETCH-LICENSE))

Local modification:
- Reddit keyword search defaults to `sort=new` so the scraper prioritizes the newest public posts for the application's 48-hour monitoring window.

The application invokes this script with Python 3 and does not require SocialFetch's optional YouTube dependencies.
