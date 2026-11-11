@echo off
chcp 65001 > nul
rem テストの記録（?by=owner で開いたセッション）を、待たずに今すぐ GitHub へ渡す。ダブルクリックで動く
echo テストの記録を GitHub へ渡しています...
ssh tb1 "SYNC_NOW=1 $HOME/.nvm/versions/node/v24.14.1/bin/node $HOME/docker-templates/RealEstate_app/tools/sync-owner.mjs && echo 終わりました（新しい記録がなければ、何も上げていません）"
pause
