import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:quiz_new/protocol.dart';

const stateJson =
    '{"type":"state","phase":"final","isHost":false,"you":{"id":"p1","name":"たろう","score":2,"rank":1,"connected":true},"youLockedOut":true,'
    '"players":[{"id":"p1","name":"たろう","score":2,"rank":1,"connected":true},{"id":"p2","name":"はなこ","score":0,"rank":2,"connected":false}],'
    '"questionNumber":3,"questionCount":10,"questionText":"問題","revealedChars":2,"revealing":false,"remainingMs":null,'
    '"answererId":"p1","answererName":"たろう","lastWrongName":null,"result":{"correctChoice":"北岳","winnerName":null}}';

void main() {
  test('state を読める', () {
    final s = (parseServerMessage(stateJson) as StateMessage).state;
    expect(s.phase, Phase.finished);
    expect(s.you!.name, 'たろう');
    expect(s.youLockedOut, true);
    expect(s.players[1].connected, false);
    expect(s.questionCount, 10);
    expect(s.remainingMs, isNull);
    expect(s.answererName, 'たろう');
    expect(s.resultCorrectChoice, '北岳');
    expect(s.resultWinnerName, isNull);
    expect(s.hasResult, true);
  });

  test('you と result が null の state', () {
    final s = (parseServerMessage(
                '{"type":"state","phase":"lobby","isHost":true,"you":null,"youLockedOut":false,"players":[],"questionNumber":0,"questionCount":0,"questionText":"","revealedChars":0,"revealing":false,"remainingMs":null,"answererId":null,"answererName":null,"lastWrongName":null,"result":null}')
            as StateMessage)
        .state;
    expect(s.isHost, true);
    expect(s.you, isNull);
    expect(s.hasResult, false);
  });

  test('その他のメッセージ', () {
    expect((parseServerMessage('{"type":"choices","choices":["a","b","c","d"]}') as ChoicesMessage).choices,
        ['a', 'b', 'c', 'd']);
    final sets =
        parseServerMessage('{"type":"sets","sets":[{"id":"s1","name":"歴史","count":8}],"selectedId":null}') as SetsMessage;
    expect(sets.sets.single.count, 8);
    expect(sets.selectedId, isNull);
    expect(
        (parseServerMessage('{"type":"error","code":"name_taken","message":"その名前はすでに使われています"}') as ErrorMessage)
            .message,
        'その名前はすでに使われています');
    expect(parseServerMessage('{"type":"kicked"}'), isA<KickedMessage>());
  });

  test('壊れた入力は null', () {
    for (final raw in [
      '',
      'abc',
      '[]',
      '{}',
      '{"type":"nope"}',
      '{"type":"state"}',
      '{"type":"state","phase":"unknown"}',
      '{"type":"choices","choices":"abcd"}',
      '{"type":"sets","sets":[{"id":1}]}',
    ]) {
      expect(parseServerMessage(raw), isNull, reason: raw);
    }
  });

  test('送信メッセージ', () {
    expect(jsonDecode(encodeJoin('ab', 'たろう')), {'type': 'join', 'playerId': 'ab', 'name': 'たろう'});
    expect(jsonDecode(encodeHostLogin('1234')), {'type': 'host_login', 'pin': '1234'});
    expect(jsonDecode(encodeAnswer(2)), {'type': 'answer', 'choice': 2});
    expect(jsonDecode(encodeHostStart('s1')), {'type': 'host_start', 'setId': 's1'});
    expect(jsonDecode(encodeHostKick('p1')), {'type': 'host_kick', 'playerId': 'p1'});
    expect(jsonDecode(encodeBuzz()), {'type': 'buzz'});
    expect(jsonDecode(encodeHostAbort()), {'type': 'host_abort'});
    expect(jsonDecode(encodeHostAgain()), {'type': 'host_again'});
    expect(jsonDecode(encodeHostClear()), {'type': 'host_clear'});
  });
}
