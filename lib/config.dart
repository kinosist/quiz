/// 接続先のサーバー。
///
/// 既定値は Android エミュレーターから開発機上の `npm run dev` に届くアドレス。
/// 変えるときは `--dart-define=SERVER_URL=wss://.../ws` を付けてビルドする。
const serverUrl = String.fromEnvironment('SERVER_URL', defaultValue: 'ws://10.0.2.2:8787/ws');
