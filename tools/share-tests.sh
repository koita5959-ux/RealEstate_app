#!/bin/sh
# テストの記録を GitHub へ渡す（中身は share-tests.mjs）。Windows から：ssh -t tb1 ~/docker-templates/RealEstate_app/tools/share-tests.sh
exec ~/.nvm/versions/node/v24.14.1/bin/node "$(dirname "$0")/share-tests.mjs" "$@"
