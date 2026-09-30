with open('e:/mponline/apps/api/app/main.py', 'r') as f:
    content = f.read()

# Find and print the CORSMiddleware setup section
idx = content.find('add_middleware')
if idx != -1:
    # Find the line containing add_middleware
    line_start = content.rfind('\n', 0, idx) + 1
    line_end = content.find('\n', idx)
    print(content[line_start:line_end])
else:
    print("add_middleware not found")

# Also find CORSMiddleware
idx2 = content.find('CORSMiddleware')
if idx2 != -1:
    line_start = content.rfind('\n', 0, idx2) + 1
    line_end = content.find('\n', idx2)
    print(content[line_start:line_end])
else:
    print("CORSMiddleware not found")