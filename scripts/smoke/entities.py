#!/usr/bin/env python3
"""Exercise rich-text persistence through the edge (run after chat.sh)."""
import json
import sys
import urllib.error
import urllib.request

base, session_cookie, chat_id = sys.argv[1:]


def request(method, path, body=None, status=200):
    req = urllib.request.Request(
        base + '/api/v2' + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            'Cookie': session_cookie,
            'Content-Type': 'application/json',
            'Origin': base,
        },
        method=method,
    )
    try:
        response = urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        data = json.load(response)
        assert response.code == status, (method, path, response.code, data)
    return data


def send(item):
    """Отправка всегда пачкой (#808): здесь пачка из одного."""
    return request('POST', '/messages/' + chat_id, {'messages': [item]}, status=201)['messages'][0]


content ='entities-smoke a & b <i>x</i> "q" 😀'
entities = [
    {'type': 'bold', 'offset': 0, 'length': 14},
    {'type': 'link', 'offset': 15, 'length': 1, 'data': {'url': 'https://example.com/docs'}},
]


def check_message(message, expected_content=content, expected_entities=entities):
    assert message['content'] == expected_content, message
    assert message['entities'] == expected_entities, message


print('\n→ Message entities')
message = send({'content': content, 'entities': entities})
message_id = message['id']
check_message(message)
check_message(next(m for m in request('GET', '/messages/' + chat_id)['messages'] if m['id'] == message_id))
chat = next(c for c in request('GET', '/chats')['chats'] if c['id'] == chat_id)
check_message(chat['lastMessage'])
reply = send({'content': 'reply', 'replyTo': message_id})
check_message(reply['replyPreview'])
assert reply['entities'] == []
request('POST', '/chats/' + chat_id + '/pins/' + message_id)
check_message(next(p['message'] for p in request('GET', '/chats/' + chat_id + '/pins')['pins'] if p['messageId'] == message_id))
request('POST', '/messages/' + message_id + '/favorite')
check_message(next(m for m in request('GET', '/messages/favorites')['messages'] if m['id'] == message_id))
check_message(next(m for m in request('GET', '/messages/search?q=entities')['messages'] if m['id'] == message_id))
# Пересылка — обычная отправка с forwardedFrom (#808): содержимое и
# entities присылает клиент, сервер хранит их как есть.
forward = send({'content': content, 'entities': entities, 'forwardedFrom': message_id})
check_message(forward)
# Repeat forwarding to catch accidental double escaping.
check_message(send({'content': content, 'entities': entities, 'forwardedFrom': forward['id']}))
changed = [{'type': 'italic', 'offset': 0, 'length': 7}]
check_message(request('PUT', '/messages/' + message_id, {'content': content, 'entities': changed}), content, changed)
check_message(request('PUT', '/messages/' + message_id, {'content': content}), content, [])
check_message(request('PUT', '/messages/' + message_id, {'content': content, 'entities': []}), content, [])
before = len(request('GET', '/messages/' + chat_id)['messages'])
for bad in [
    {'content': 'x', 'entities': [{'type': 'link', 'offset': 0, 'length': 1, 'data': {'url': 'javascript:alert(1)'}}]},
    {'content': 'x' * 16385},
    {'content': '😀', 'entities': [{'type': 'bold', 'offset': 0, 'length': 1}]},
    {'type': 'sticker', 'mediaUrl': '/sticker', 'entities': [{'type': 'bold', 'offset': 0, 'length': 1}]},
]:
    data = request('POST', '/messages/' + chat_id, {'messages': [bad]}, status=400)
    assert data['code'] == 'validation_failed', data
assert len(request('GET', '/messages/' + chat_id)['messages']) == before
# The plaintext limit must not apply to an opaque E2E transport envelope.
envelope = json.dumps({'v': 2, 'e2e': True, 'iv': 'iv', 'data': 'x' * 17000})
check_message(send({'content': envelope}), envelope, [])
assert request('POST', '/messages/' + chat_id, {'messages': [{'content': envelope, 'entities': entities}]}, status=400)['code'] == 'validation_failed'
print('✓ [entities] send/list/previews/pins/favorites/search/edit/forward, limits and E2E')
