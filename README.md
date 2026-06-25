# PC 사양 추천 AI — Vercel 배포 가이드

## 파일 구조
```
pc-advisor-vercel/
├── api/
│   └── chat.js        ← Anthropic API 프록시 (키 여기 숨김)
├── public/
│   └── index.html     ← 앱 본체
├── vercel.json
└── package.json
```

---

## 배포 방법 (15분)

### 1단계 — GitHub에 올리기

이 폴더 전체를 GitHub에 올려야 합니다.

**GitHub 처음이라면:**
1. [github.com](https://github.com) → 회원가입 → 로그인
2. 우측 상단 `+` → `New repository`
3. Repository name: `pc-advisor` → `Create repository`
4. 생성된 페이지에서 "uploading an existing file" 클릭
5. 이 폴더 안의 파일들을 **구조 그대로** 드래그 업로드
   - `api/chat.js`
   - `public/index.html`
   - `vercel.json`
   - `package.json`
6. `Commit changes` 클릭

**Git 사용할 수 있다면:**
```bash
cd pc-advisor-vercel
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/내아이디/pc-advisor.git
git push -u origin main
```

---

### 2단계 — Vercel 연결

1. [vercel.com](https://vercel.com) → `Continue with GitHub` 로그인
2. `Add New Project` 클릭
3. GitHub에서 `pc-advisor` repo 선택 → `Import`
4. 설정 건드리지 말고 바로 `Deploy` 클릭
5. 1~2분 기다리면 배포 완료 🎉

---

### 3단계 — API 키 등록 (필수!)

배포 후 앱이 작동하려면 Anthropic API 키를 Vercel에 등록해야 합니다.

1. Vercel 대시보드 → 방금 만든 프로젝트 클릭
2. 상단 탭 `Settings` → 좌측 메뉴 `Environment Variables`
3. 아래처럼 입력:
   - **Key**: `ANTHROPIC_API_KEY`
   - **Value**: `sk-ant-api03-...` (본인 Anthropic 키)
4. `Save` 클릭
5. 상단 `Deployments` → 최신 배포 우측 `···` → `Redeploy`

---

### 4단계 — 완료!

`https://pc-advisor-XXX.vercel.app` 형태의 URL이 생성됩니다.
이 링크를 누구에게나 공유하면 API 키 없이 바로 사용 가능합니다.

---

## Anthropic API 키 발급

키가 없다면: [console.anthropic.com](https://console.anthropic.com/keys)
- 회원가입 후 `Create Key` → 복사
- 처음 가입하면 5달러 크레딧 무료 제공
