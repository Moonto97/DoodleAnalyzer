"""
🎨 낙서 분석가 (Doodle Analyzer)
AI 미술 감상 시뮬레이션 게임

자유롭게 낙서하면 GPT-4o-mini가 그림을 보고 거창한 미술 평론을 해줍니다!

설정: .streamlit/secrets.toml 파일에 시크릿 정보 입력
실행: streamlit run app.py
"""

import streamlit as st
import streamlit.components.v1 as components
import os
import json
import threading
import smtplib
import base64
import time
import uuid
from http.server import HTTPServer, BaseHTTPRequestHandler
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.image import MIMEImage

# ============================================================
#  Configuration (secrets loaded from .streamlit/secrets.toml)
# ============================================================
PROXY_PORT = 8502

# Load secrets from .streamlit/secrets.toml via st.secrets
try:
    API_KEY = st.secrets.get('OPENAI_API_KEY', '')
    PROXY_API_URL = st.secrets.get('PROXY_API_URL', '')
    _smtp = st.secrets.get('smtp', {})
    SMTP_EMAIL = _smtp.get('email', '') if _smtp else ''
    SMTP_PASSWORD = _smtp.get('password', '') if _smtp else ''
    SMTP_SERVER = _smtp.get('server', 'smtp.gmail.com') if _smtp else 'smtp.gmail.com'
    SMTP_PORT = int(_smtp.get('port', 587)) if _smtp else 587
except FileNotFoundError:
    API_KEY = ''
    PROXY_API_URL = ''
    SMTP_EMAIL = ''
    SMTP_PASSWORD = ''
    SMTP_SERVER = 'smtp.gmail.com'
    SMTP_PORT = 587

SYSTEM_PROMPT = """당신은 세계적으로 유명한 미술 평론가인데, 겉으로는 극도로 진지하고 격조 높은 척하지만 실제 내용은 점점 병맛(웃긴 헛소리)으로 빠지는 스타일입니다.

핵심 톤:
- 처음에는 정말 대단한 평론처럼 시작하세요 (진지한 미술 용어, 철학적 표현 사용)
- 그러다가 중간부터 슬슬 말이 이상해지기 시작합니다
- 마지막에는 완전히 헛소리이지만, 본인은 여전히 진지한 척합니다
- 격조 높은 문체는 끝까지 유지하되, 내용이 점점 미쳐가는 갭이 핵심입니다

예시 패턴:
- "이 붓터치에서 렘브란트의 영향이 느껴진다" → "특히 이 부분은 작가가 점심을 먹다가 갑자기 영감을 받은 것이 분명하다"
- 엉뚱한 곳에서 심오한 의미를 찾아내세요 (삐뚤어진 선 = 자본주의의 모순, 빈 공간 = 작가의 냉장고 속 공허함)
- 가격은 터무니없이 매기세요 (치킨 3마리 + 콜라, 아파트 반채, 비트코인 0.00003개 등)
- 있지도 않은 예술 사조를 그럴듯하게 만들어내세요

반드시 아래 JSON 형식으로만 응답하세요:
{
  "title": "거창하면서도 살짝 이상한 작품 제목 (한국어)",
  "movement": "있어 보이지만 실은 말도 안 되는 예술 사조 (한국어)",
  "movement_en": "그럴듯한 영어 사조 이름",
  "movement_desc": "이 사조를 진지하게 설명하는 한 문장인데 읽다 보면 웃긴 것 (한국어, ~한다 체)",
  "rating": "1~5 사이 숫자 (별 이유 없이 자신감 있게)",
  "interpretation": "처음엔 진지하다가 점점 병맛으로 빠지는 3-4문단 해석 (한국어, 각 문단을 \\n\\n으로 구분)",
  "emotions": "진지한 감정 분석인 줄 알았는데 읽어보면 웃긴 한 문장 (한국어)",
  "price": "터무니없고 구체적인 가격 (치킨 몇 마리, 편의점 삼각김밥 몇 개 등 한국 음식/물건으로)",
  "exhibition": "있을 법하면서도 웃긴 전시회 이름 (한국어)",
  "closing": "격조 높은 척하면서 병맛인 마무리 한마디 (한국어)"
}

중요한 규칙:
1. 낙서를 실제로 자세히 관찰하고 색상, 형태, 구도 등을 정확히 묘사하세요
2. 진지한 미술 평론 문체를 끝까지 유지하되, 내용은 점점 미쳐가야 합니다
3. 한국 문화/일상 레퍼런스를 적극 활용하세요 (편의점, 치킨, 수능, 지하철 등)
4. 유명 화가나 작품을 엉뚱하게 비교하세요 (예: "모나리자가 이 작품을 봤다면 미소를 거뒀을 것이다")
5. 반드시 유효한 JSON으로만 응답하세요 (JSON 외의 텍스트는 절대 포함하지 마세요)
6. interpretation은 반드시 3문단 이상, 갈수록 더 병맛으로 작성하세요
7. 너무 노력해서 웃기려 하지 말고, 진지한 척하는 갭에서 자연스럽게 웃음이 나오게 하세요"""


# ============================================================
#  Gallery Storage (JSON file with thread lock)
# ============================================================
GALLERY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gallery.json')
GALLERY_MAX = 100  # Max doodles in gallery
_gallery_lock = threading.Lock()


def _load_gallery():
    """Load gallery data from JSON file (call within lock)."""
    try:
        with open(GALLERY_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _save_gallery(data):
    """Save gallery data to JSON file (call within lock)."""
    with open(GALLERY_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)


# ============================================================
#  OpenAI Proxy Server (secrets loaded from .streamlit/secrets.toml)
# ============================================================
class APIHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        """Handle GET requests (gallery listing)."""
        try:
            if self.path == '/gallery':
                with _gallery_lock:
                    gallery = _load_gallery()
                # Sort by likes desc, then by created_at desc
                gallery.sort(key=lambda x: (x.get('likes', 0), x.get('created_at', 0)), reverse=True)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'gallery': gallery}, ensure_ascii=False).encode('utf-8'))
                return

            self.send_response(404)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}, ensure_ascii=False).encode('utf-8'))

    def do_POST(self):
        try:
            if self.path == '/gallery/save':
                content_length = int(self.headers['Content-Length'])
                body = json.loads(self.rfile.read(content_length))
                image_data = body.get('image', '')
                title = body.get('title', '무제')

                if not image_data:
                    raise ValueError("이미지 데이터가 필요합니다.")

                entry = {
                    'id': str(uuid.uuid4())[:8],
                    'image': image_data,
                    'title': title[:50],  # limit title length
                    'likes': 0,
                    'created_at': time.time()
                }

                with _gallery_lock:
                    gallery = _load_gallery()
                    gallery.append(entry)
                    # Keep only the most recent GALLERY_MAX entries
                    if len(gallery) > GALLERY_MAX:
                        # Sort by likes desc to keep popular ones
                        gallery.sort(key=lambda x: (x.get('likes', 0), x.get('created_at', 0)), reverse=True)
                        gallery = gallery[:GALLERY_MAX]
                    _save_gallery(gallery)

                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'success': True, 'id': entry['id']}, ensure_ascii=False).encode('utf-8'))
                return

            if self.path == '/gallery/like':
                content_length = int(self.headers['Content-Length'])
                body = json.loads(self.rfile.read(content_length))
                doodle_id = body.get('id', '')

                if not doodle_id:
                    raise ValueError("낙서 ID가 필요합니다.")

                with _gallery_lock:
                    gallery = _load_gallery()
                    found = False
                    for item in gallery:
                        if item['id'] == doodle_id:
                            item['likes'] = item.get('likes', 0) + 1
                            found = True
                            likes = item['likes']
                            break
                    if found:
                        _save_gallery(gallery)

                if not found:
                    raise ValueError("해당 낙서를 찾을 수 없습니다.")

                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'success': True, 'likes': likes}, ensure_ascii=False).encode('utf-8'))
                return

            if self.path == '/gallery/unlike':
                content_length = int(self.headers['Content-Length'])
                body = json.loads(self.rfile.read(content_length))
                doodle_id = body.get('id', '')

                if not doodle_id:
                    raise ValueError("낙서 ID가 필요합니다.")

                with _gallery_lock:
                    gallery = _load_gallery()
                    found = False
                    for item in gallery:
                        if item['id'] == doodle_id:
                            item['likes'] = max(0, item.get('likes', 0) - 1)
                            found = True
                            likes = item['likes']
                            break
                    if found:
                        _save_gallery(gallery)

                if not found:
                    raise ValueError("해당 낙서를 찾을 수 없습니다.")

                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'success': True, 'likes': likes}, ensure_ascii=False).encode('utf-8'))
                return

            if self.path == '/email':
                # Email sending handler
                content_length = int(self.headers['Content-Length'])
                body = json.loads(self.rfile.read(content_length))
                recipient = body.get('email', '')
                image_data = body.get('image', '')

                if not SMTP_EMAIL or not SMTP_PASSWORD:
                    raise ValueError(".streamlit/secrets.toml 파일에 [smtp] 섹션의 email과 password를 설정해주세요.")

                if not recipient:
                    raise ValueError("이메일 주소가 필요합니다.")

                # Decode base64 image
                img_b64 = image_data.split(',')[1] if ',' in image_data else image_data
                img_bytes = base64.b64decode(img_b64)

                # Compose email
                msg = MIMEMultipart('related')
                msg['Subject'] = '🎨 낙서 분석가 - 작품 분석 결과'
                msg['From'] = SMTP_EMAIL
                msg['To'] = recipient

                html_body = """
                <div style="max-width:700px;margin:0 auto;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;background:#FFFCF2;padding:30px;border-radius:16px;border:2px solid #FFD700;">
                    <h1 style="text-align:center;color:#FF6B6B;">🎨 낙서 분석가</h1>
                    <p style="text-align:center;color:#888;font-style:italic;">- 모든 낙서는 무의식을 투영한다 -</p>
                    <hr style="border:none;border-top:1px dashed #FFD700;margin:20px 0;">
                    <p style="text-align:center;color:#555;">당신의 낙서 분석 결과가 도착했습니다!</p>
                    <div style="text-align:center;margin:20px 0;">
                        <img src="cid:analysis_image" style="max-width:100%;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
                    </div>
                    <p style="text-align:center;color:#aaa;font-size:0.85em;margin-top:20px;">낙서 분석가 · Doodle Analyzer</p>
                </div>
                """

                html_part = MIMEText(html_body, 'html', 'utf-8')
                msg.attach(html_part)

                img_mime = MIMEImage(img_bytes, 'png')
                img_mime.add_header('Content-ID', '<analysis_image>')
                img_mime.add_header('Content-Disposition', 'attachment', filename='doodle_analysis.png')
                msg.attach(img_mime)

                # Send
                with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
                    server.starttls()
                    server.login(SMTP_EMAIL, SMTP_PASSWORD)
                    server.send_message(msg)

                # Success response
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'success': True}, ensure_ascii=False).encode('utf-8'))
                return

            # Default GPT proxy handler (for path='/')
            if not API_KEY:
                raise ValueError(".streamlit/secrets.toml 파일에 OPENAI_API_KEY가 설정되지 않았습니다.")

            content_length = int(self.headers['Content-Length'])
            body = json.loads(self.rfile.read(content_length))
            image_data = body.get('image', '')

            from openai import OpenAI
            client = OpenAI(api_key=API_KEY)

            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": [
                        {"type": "text", "text": "이 그림을 분석하고 미술 평론을 작성해주세요."},
                        {"type": "image_url", "image_url": {"url": image_data}}
                    ]}
                ],
                max_tokens=1500,
                temperature=0.9,
                response_format={"type": "json_object"},
            )

            result = response.choices[0].message.content

            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'critique': result}, ensure_ascii=False).encode('utf-8'))
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}, ensure_ascii=False).encode('utf-8'))

    def log_message(self, format, *args):
        pass  # Suppress console logs


@st.cache_resource
def start_proxy():
    """Start the API proxy server once (cached across reruns)."""
    try:
        server = HTTPServer(('127.0.0.1', PROXY_PORT), APIHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return True
    except OSError:
        return True  # Port already in use = server already running


# ============================================================
#  Streamlit App
# ============================================================
st.set_page_config(
    page_title="🎨 낙서 분석가",
    page_icon="🎨",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# Start proxy server
start_proxy()

# Hide default Streamlit UI for immersive experience
st.markdown("""
<style>
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    header {visibility: hidden;}
    .block-container {
        padding: 0 !important;
        max-width: 100% !important;
    }
    .stAppDeployButton {display: none;}
    iframe {
        border: none !important;
    }
</style>
""", unsafe_allow_html=True)

# Load and render game HTML
html_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'game.html')
with open(html_path, 'r', encoding='utf-8') as f:
    html_content = f.read()

# Inject configuration into HTML
html_content = html_content.replace('__PROXY_PORT__', str(PROXY_PORT))
html_content = html_content.replace('__HAS_API_KEY__', 'true' if (API_KEY or PROXY_API_URL) else 'false')
html_content = html_content.replace('__PROXY_API_URL__', PROXY_API_URL.rstrip('/'))

components.html(html_content, height=900, scrolling=False)
