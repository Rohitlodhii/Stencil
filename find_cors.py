with open('e:/mponline/apps/api/app/main.py', 'r') as f:
    content = f.read()

idx = content.find('add_middleware')
while idx != -1:
    start = content.rfind('\n', 0, idx)
    end = content.find('\n', idx)
    print(content[start:end])
    idx = content.find('add_middleware', idx + 1)

print("---")
# Also find CORSMiddleware usage
idx2 = content.find('CORSMiddleware')
while idx2 != -1:
    start = content.rfind('\n', 0, idx2)
    end = content.find('\n', idx2)
    print(content[start:end])
    idx2 = content.find('CORSMiddleware', idx2 + 1)