# 검토 에이전트(TLS-4c)의 시험 인증서 생성. 사용법: bash scripts/probe/tls4c-review/mk.sh <임시 폴더>  (openssl 필요, Git Bash)
# 시험용 키·인증서는 그 폴더에만 만든다. 저장소 안에 만들지 않는다.
cd "$1" || exit 1
set -e
export MSYS_NO_PATHCONV=1
# 루트(시험용)
openssl req -x509 -newkey rsa:2048 -nodes -keyout root.key -out root.pem -days 30 -subj "/CN=rv root" -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
# 이름 제약 중간 CA: permitted DNS:.example.com 만
cat > nc.ext <<E
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
nameConstraints=critical,permitted;DNS:.example.com
E
openssl req -newkey rsa:2048 -nodes -keyout nc.key -out nc.csr -subj "/CN=nc int" 2>/dev/null
openssl x509 -req -in nc.csr -CA root.pem -CAkey root.key -CAcreateserial -out nc.pem -days 30 -extfile nc.ext 2>/dev/null
leaf() { # name signerPem signerKey extfile [keyopts] [mdopt]
  openssl req -newkey ${5:-rsa:2048} -nodes -keyout $1.key -out $1.csr -subj "/CN=localhost" 2>/dev/null
  openssl x509 -req -in $1.csr -CA $2 -CAkey $3 -CAcreateserial -out $1.pem -days 10 -extfile $4 ${6:--sha256} 2>/dev/null
}
printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\n' > san.ext
printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\nkeyUsage=critical,keyCertSign\n' > ku.ext
printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=clientAuth\n' > eku.ext
printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\n1.2.3.4.5=critical,ASN1:NULL\n' > crit.ext
printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\n' > ee.ext
leaf nc_leaf nc.pem nc.key san.ext ; cat nc_leaf.pem nc.pem > nc_chain.pem
leaf ku_leaf root.pem root.key ku.ext
leaf eku_leaf root.pem root.key eku.ext
leaf crit_leaf root.pem root.key crit.ext
leaf sha1_leaf root.pem root.key san.ext rsa:2048 -sha1
leaf rsa1024_leaf root.pem root.key san.ext rsa:1024
leaf rsa768_leaf root.pem root.key san.ext rsa:768 || echo "768 실패"
# 중간 CA가 CA:FALSE인 체인 (INVALID_CA 비교용)
openssl req -newkey rsa:2048 -nodes -keyout nonca.key -out nonca.csr -subj "/CN=nonca int" 2>/dev/null
openssl x509 -req -in nonca.csr -CA root.pem -CAkey root.key -CAcreateserial -out nonca.pem -days 30 -extfile ee.ext 2>/dev/null
leaf nonca_leaf nonca.pem nonca.key san.ext ; cat nonca_leaf.pem nonca.pem > nonca_chain.pem
# 중간 CA 없이 leaf만 (UNABLE_TO_VERIFY_LEAF_SIGNATURE 비교용)
cp nc_leaf.pem onlyleaf.pem; cp nc_leaf.key onlyleaf.key
for f in nc_chain ku_leaf eku_leaf crit_leaf sha1_leaf rsa1024_leaf rsa768_leaf nonca_chain; do test -f $f.pem && echo ok $f; done
# 정상 leaf(cert-classify의 기준·클라이언트 인증서 요구 사례용 — 에이전트는 따로 만들었다)
leaf good root.pem root.key san.ext
