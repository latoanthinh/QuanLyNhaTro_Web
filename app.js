
        import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
        import { getDatabase, ref, get, set, remove, child, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
        import { getAuth, onAuthStateChanged, setPersistence, browserLocalPersistence, browserSessionPersistence, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

        const firebaseConfig = {
            apiKey: "AIzaSyD-_W9YnybWOgWYbP2jydZWVpW0KabE-Y8",
            authDomain: "quanlynhatro-e35b2.firebaseapp.com",
            databaseURL: "https://quanlynhatro-e35b2-default-rtdb.asia-southeast1.firebasedatabase.app/",
            projectId: "quanlynhatro-e35b2",
            storageBucket: "quanlynhatro-e35b2.firebasestorage.app",
            messagingSenderId: "939635608313",
            appId: "1:939635608313:web:a7047a74b3a2ec04bd7028"
        };

        const BANK_CONFIG = {
            bankBin: "970407",
            accountNo: "19038191013016",
            accountName: "LA TOAN THINH"
        };

        const MAX_ROOMS = 12;
        const MAX_TEXT_LENGTH = 500;
        const MAX_COLLECTION_ITEMS = 1000;
        const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
        const MAX_RECORD_BYTES = 250000;
        const ADMIN_SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

        const app = initializeApp(firebaseConfig);
        const db = getDatabase(app);
        const auth = getAuth(app);
        const firebaseAuthConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId);

        let roomsData = [];
        let issuesData = [];
        let invoicesData = [];
        let paymentRequestsData = [];
        let chatsData = {};
        let activeTenantRoom = null;
        let activeInvoiceRequest = null;
        let currentEditingDocId = null;
        let revenueChartInstance = null;
        let selectedAdminChatRoomId = null;
        let adminUser = null;
        let archiveSnapshotsData = [];

        const ARCHIVE_PATH = 'archives';

        function esc(value) {
            return String(value ?? '').replace(/[&<>"']/g, char => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[char]));
        }

        function boundedText(value, max = MAX_TEXT_LENGTH) {
            return String(value ?? '').trim().slice(0, max);
        }

        function assertRecordSize(value) {
            const size = new Blob([JSON.stringify(value)]).size;
            if (size > MAX_RECORD_BYTES) throw new Error('Dữ liệu bản ghi vượt quá giới hạn cho phép.');
        }

        function currentMonthKey(date = new Date()) {
            return `${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
        }

        function authRequiredMessage() {
            return firebaseAuthConfigured
                ? 'Vui lòng đăng nhập bằng tài khoản email/password Firebase đã được cấp quyền.'
                : 'Firebase Authentication chưa được cấu hình (kiểm tra firebaseConfig và bật Email/Password trong Firebase Console). Chưa có mật khẩu dự phòng hardcode.';
        }

        onAuthStateChanged(auth, async user => {
            const loginAt = Number(localStorage.getItem('adminLoginAt') || 0);
            if (user && loginAt > 0 && Date.now() - loginAt >= ADMIN_SESSION_MAX_AGE) {
                await signOut(auth);
                localStorage.removeItem('adminLoginAt');
                sessionStorage.removeItem('isAdminLoggedIn');
                Toast.fire({ icon: 'info', title: 'Phiên đăng nhập đã hết hạn sau 30 ngày.' });
                return;
            }

            adminUser = user || null;
            if (user) {
                localStorage.setItem('adminLoginAt', String(loginAt || Date.now()));
                sessionStorage.setItem('isAdminLoggedIn', 'true');
            } else {
                localStorage.removeItem('adminLoginAt');
                sessionStorage.removeItem('isAdminLoggedIn');
            }
        });

        const Toast = Swal.mixin({
            toast: true,
            position: 'top',
            showConfirmButton: false,
            timer: 1000,
            timerProgressBar: true,
            customClass: {
                popup: '!text-[11px] !py-1.5 !px-3 !rounded-lg !max-w-[220px] shadow-sm'
            },
            didOpen: (toast) => {
                toast.addEventListener('click', Swal.close);
            }
        });

        function showLoading() { document.getElementById('global-loading').classList.remove('hidden'); }
        function hideLoading() { document.getElementById('global-loading').classList.add('hidden'); }

        function getErrorMessage(error) {
            if (error && typeof error.message === 'string' && error.message.trim()) {
                return error.message.trim();
            }
            return 'Lỗi không xác định từ hệ thống dữ liệu.';
        }

        function notifyError(error, title = 'Thao tác thất bại') {
            const message = getErrorMessage(error);
            console.error(title, error);
            Toast.fire({ icon: 'error', title: `${title}: ${message}` });
        }

        async function executeWithLock(btnElement, asyncFn) {
            if (btnElement && btnElement.dataset.processing === "true") return;

            if (btnElement) {
                btnElement.dataset.processing = "true";
                btnElement.classList.add("pointer-events-none", "opacity-50");
            }

            try {
                await asyncFn();
            } catch (error) {
                hideLoading();
                notifyError(error);
            } finally {
                if (btnElement) {
                    delete btnElement.dataset.processing;
                    btnElement.classList.remove("pointer-events-none", "opacity-50");
                }
            }
        }

        window.parseNum = (v) => {
            if (!v) return 0;
            const cleanStr = v.toString().replace(/,/g, "").replace(/^0+(?=\d)/, "");
            return Number(cleanStr) || 0;
        };

        const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
        const MAX_IMAGE_DATA_LENGTH = 900000;

        function readImageAsDataUrl(file) {
            return new Promise((resolve, reject) => {
                if (!file) return resolve('');
                if (!file.type.startsWith('image/')) {
                    reject(new Error('Tệp đính kèm phải là hình ảnh.'));
                    return;
                }
                if (file.size > MAX_IMAGE_BYTES) {
                    reject(new Error('Hình ảnh không được vượt quá 5 MB.'));
                    return;
                }

                const reader = new FileReader();
                reader.onload = () => {
                    const image = new Image();
                    image.onload = () => {
                        const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
                        const canvas = document.createElement('canvas');
                        canvas.width = Math.max(1, Math.round(image.width * scale));
                        canvas.height = Math.max(1, Math.round(image.height * scale));
                        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
                        if (dataUrl.length > MAX_IMAGE_DATA_LENGTH) {
                            reject(new Error('Hình ảnh sau khi nén vẫn quá lớn. Vui lòng chọn ảnh nhỏ hơn.'));
                            return;
                        }
                        resolve(dataUrl);
                    };
                    image.onerror = () => reject(new Error('Không thể đọc hình ảnh đã chọn.'));
                    image.src = reader.result;
                };
                reader.onerror = () => reject(new Error('Không thể đọc tệp hình ảnh.'));
                reader.readAsDataURL(file);
            });
        }

        function imagePreviewHtml(image, alt = 'Hình ảnh đính kèm') {
            if (!image || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(String(image))) return '';
            return `<a href="${esc(image)}" target="_blank" rel="noopener"><img src="${esc(image)}" alt="${esc(alt)}" class="max-w-full max-h-48 rounded-lg border border-slate-200 object-contain mt-1"></a>`;
        }

        function extractRoomNumber(name) {
            const match = (name || "").match(/\d+/);
            return match ? parseInt(match[0], 10) : 0;
        }

        function sortRooms(list) {
            return list.sort((a, b) => extractRoomNumber(a.name) - extractRoomNumber(b.name));
        }

        window.formatAndCalculate = function (el) {
            let val = parseNum(el.value);
            el.value = val === 0 && el.value === "" ? "" : val.toLocaleString('en-US');
            calculateTotal();
        };

        window.handleNumFocus = function (el) {
            if (el.value === "0" || el.value === "00") {
                el.value = "";
            } else {
                el.select();
            }
        };

        window.handleNumBlur = function (el, defaultVal = 0) {
            if (el.value.trim() === "") {
                el.value = defaultVal.toLocaleString('en-US');
            }
            calculateTotal();
        };

        window.alertOldNumEdit = function () {
            Swal.fire({
                title: 'Hạn chế chỉnh sửa số cũ',
                text: 'Số cũ đã được chốt tự động. Nếu muốn thay đổi số cũ, bạn bắt buộc phải thay đổi trực tiếp trong cơ sở dữ liệu (Database)!',
                icon: 'warning',
                confirmButtonColor: '#4f46e5',
                confirmButtonText: 'Đã hiểu',
                customClass: { popup: 'rounded-xl text-xs' }
            });
        };

        window.switchView = function (view) {
            if (view === 'tenant') {
                document.getElementById('view-tenant').classList.remove('hidden');
                document.getElementById('view-admin').classList.add('hidden');
            }
        };

        window.switchAdminTab = function (tabId) {
            document.querySelectorAll('.admin-tab-content').forEach(el => el.classList.add('hidden'));
            document.querySelectorAll('.admin-tab-btn').forEach(btn => {
                btn.classList.remove('active-sidebar-item', 'bg-indigo-600', 'text-white', 'bg-slate-50', 'text-slate-600');
                btn.classList.add('bg-slate-50', 'text-slate-600');
            });

            document.getElementById(tabId).classList.remove('hidden');

            const activeBtn = document.getElementById('nav-' + tabId);
            if (activeBtn) {
                activeBtn.classList.remove('bg-slate-50', 'text-slate-600');
                activeBtn.classList.add('active-sidebar-item', 'bg-indigo-600', 'text-white');
            }

            if (tabId === 'tab-overview') renderOverviewAnalytics();
            if (tabId === 'tab-invoices') renderInvoiceHistory();
            if (tabId === 'tab-payment-requests') renderPaymentRequests();
            if (tabId === 'tab-issues') renderAdminIssues();
            if (tabId === 'tab-chats') renderAdminChatRoomList();
        };

        window.toggleAdminNav = function () {
            const panel = document.getElementById('admin-nav-panel');
            const toggle = document.getElementById('admin-nav-toggle');
            if (!panel || !toggle) return;
            const collapsed = panel.classList.toggle('is-collapsed');
            toggle.classList.toggle('is-collapsed', collapsed);
            toggle.setAttribute('aria-expanded', String(!collapsed));
            toggle.title = collapsed ? 'Hiện thanh điều hướng' : 'Ẩn thanh điều hướng';
            localStorage.setItem('adminNavCollapsed', String(collapsed));
        };

        function restoreAdminNavState() {
            const collapsed = localStorage.getItem('adminNavCollapsed') === 'true';
            const panel = document.getElementById('admin-nav-panel');
            const toggle = document.getElementById('admin-nav-toggle');
            if (!collapsed || !panel || !toggle) return;
            panel.classList.add('is-collapsed');
            toggle.classList.add('is-collapsed');
            toggle.setAttribute('aria-expanded', 'false');
            toggle.title = 'Hiện thanh điều hướng';
        }

        window.toggleAdminMode = async function () {
            if (adminUser) {
                showAdminView();
            } else {
                if (!firebaseAuthConfigured) {
                    return Swal.fire({ title: 'Chưa cấu hình đăng nhập', text: authRequiredMessage(), icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
                }
                const result = await Swal.fire({
                    title: 'Đăng nhập Quản trị Firebase',
                    html: `<input id="firebase-email" type="email" class="swal2-input text-sm" placeholder="Email">
                        <input id="firebase-password" type="password" class="swal2-input text-sm" placeholder="Mật khẩu">
                        <label class="flex items-center justify-center gap-2 text-xs text-slate-600 mt-2 cursor-pointer">
                            <input id="firebase-remember" type="checkbox" class="accent-indigo-600" ${localStorage.getItem('adminRememberLogin') !== 'false' ? 'checked' : ''}>
                            <span>Ghi nhớ đăng nhập trong 30 ngày</span>
                        </label>`,
                    showCancelButton: true,
                    confirmButtonText: 'Đăng nhập',
                    cancelButtonText: 'Hủy',
                    confirmButtonColor: '#4f46e5',
                    customClass: { popup: 'rounded-xl text-xs' }
                });
                if (!result.isConfirmed) return;
                const email = document.getElementById('firebase-email')?.value.trim();
                const password = document.getElementById('firebase-password')?.value;
                const remember = document.getElementById('firebase-remember')?.checked === true;
                if (!email || !password) return Swal.fire({ title: 'Thiếu thông tin', text: 'Vui lòng nhập email và mật khẩu.', icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
                try {
                    showLoading();
                    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
                    await signInWithEmailAndPassword(auth, email, password);
                    localStorage.setItem('adminRememberLogin', String(remember));
                    if (remember) localStorage.setItem('adminLoginAt', String(Date.now()));
                    else localStorage.removeItem('adminLoginAt');
                    showAdminView();
                } catch (error) {
                    notifyError(error, 'Đăng nhập thất bại');
                } finally {
                    hideLoading();
                }
            }
        };

        function showAdminView() {
            document.getElementById('view-admin').classList.remove('hidden');
            document.getElementById('view-tenant').classList.add('hidden');
            restoreAdminNavState();
            loadRoomsAdmin();
        }

        window.logoutAdmin = async function () {
            try { await signOut(auth); } catch (error) { notifyError(error, 'Đăng xuất thất bại'); }
            localStorage.removeItem('adminLoginAt');
            switchView('tenant');
        };

        function calculateWater(room) {
            const occupants = Number(room.occupants || 1);
            const waterOld = parseNum(room.waterOld);
            const waterNew = parseNum(room.waterNew);
            const waterQty = Math.max(0, waterNew - waterOld);
            const hasQuota = room.hasWaterQuota !== false;
            const priceQuota = parseNum(room.waterPriceQuota || 14000);
            const priceNormal = parseNum(room.waterPriceNormal || 20000);

            if (hasQuota) {
                const quotaLimit = occupants * 4;
                if (waterQty <= quotaLimit) {
                    const total = waterQty * priceQuota;
                    return {
                        total,
                        desc: `${waterQty}m³ (Trong định mức: ${waterQty}m³ x ${priceQuota.toLocaleString()}đ = ${total.toLocaleString()}đ)`,
                        breakdown: { quotaQty: waterQty, quotaTotal: total, extraQty: 0, extraTotal: 0 }
                    };
                } else {
                    const quotaTotal = quotaLimit * priceQuota;
                    const extraQty = waterQty - quotaLimit;
                    const extraTotal = extraQty * priceNormal;
                    const total = quotaTotal + extraTotal;
                    return {
                        total,
                        desc: `${waterQty}m³ gồm: ${quotaLimit}m³ ĐM (${quotaTotal.toLocaleString()}đ) + ${extraQty}m³ vượt (${extraTotal.toLocaleString()}đ)`,
                        breakdown: { quotaQty: quotaLimit, quotaTotal, extraQty, extraTotal }
                    };
                }
            } else {
                if (waterQty === 0) {
                    const total = occupants * priceNormal;
                    return {
                        total,
                        desc: `${occupants} người x ${priceNormal.toLocaleString()}đ (Không định mức)`,
                        breakdown: { quotaQty: 0, quotaTotal: 0, extraQty: occupants, extraTotal: total }
                    };
                }
                const total = waterQty * priceNormal;
                return {
                    total,
                    desc: `${waterQty}m³ x ${priceNormal.toLocaleString()}đ (Không định mức)`,
                    breakdown: { quotaQty: 0, quotaTotal: 0, extraQty: waterQty, extraTotal: total }
                };
            }
        }

        function getRoomTotalDetails(room) {
            const price = parseNum(room.price);
            const elecOld = parseNum(room.elecOld);
            const elecNew = parseNum(room.elecNew);
            const elecQty = Math.max(0, elecNew - elecOld);
            const elecPrice = parseNum(room.elecPrice || 4000);
            const elecTotal = elecQty * elecPrice;

            const waterInfo = calculateWater(room);
            const service = parseNum(room.service);
            const currentTotal = price + elecTotal + waterInfo.total + service;
            const debt = Math.max(0, parseNum(room.previousMonthDebt ?? room.debt));
            const total = currentTotal + debt;

            return {
                price,
                elecQty,
                elecPrice,
                elecTotal,
                waterQtyDesc: waterInfo.desc,
                waterTotal: waterInfo.total,
                waterBreakdown: waterInfo.breakdown,
                service,
                currentTotal,
                debt,
                total
            };
        }

        function parseMonthFromDateStr(dateStr) {
            if (!dateStr) return null;
            let parts = dateStr.split(' ');
            let datePart = parts.find(p => p.includes('/'));
            if (!datePart) datePart = dateStr;
            let p = datePart.split('/');
            if (p.length >= 3) {
                let m = p[1].padStart(2, '0');
                let y = p[2].split(',')[0];
                return `${m}/${y}`;
            }
            return null;
        }

        function getMonthlyRevenueData() {
            const monthlyData = {};
            const now = new Date();
            const currentMonthKey = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

            const addMonthValue = (monthKey, key, value) => {
                if (!monthKey) return;
                if (!monthlyData[monthKey]) monthlyData[monthKey] = { expected: 0, paid: 0 };
                monthlyData[monthKey][key] += value;
            };

            invoicesData.forEach(inv => {
                if (inv.status !== 'Đã thanh toán') return;
                const mKey = parseMonthFromDateStr(inv.createdDate);
                if (!mKey) return;
                addMonthValue(mKey, 'paid', parseNum(inv.total));
            });

            roomsData.forEach(room => {
                if (room.status !== 'Đang thuê') return;
                const details = getRoomTotalDetails(room);
                const monthKey = currentMonthKey;
                addMonthValue(monthKey, 'expected', details.currentTotal);
                if (room.paymentStatus === 'Đã thanh toán') {
                    addMonthValue(monthKey, 'paid', details.currentTotal);
                }
            });

            return monthlyData;
        }

        function getRoomCommittedDebt(room) {
            if (!room || room.status !== 'Đang thuê') return 0;

            const explicitDebt = Math.max(0, parseNum(room.previousMonthDebt ?? room.debt));
            if (explicitDebt > 0) return explicitDebt;

            const history = Array.isArray(room.debtHistory) ? room.debtHistory : [];
            const lastClosedDebt = history.length
                ? Math.max(0, parseNum(history[history.length - 1]?.amount))
                : 0;

            return lastClosedDebt;
        }

        function getInvoiceMonthKey(invoice) {
            if (!invoice) return null;
            const timestamp = Number(invoice.createdAt || Date.parse(invoice.createdDate || ''));
            if (timestamp && Number.isFinite(timestamp)) {
                return currentMonthKey(new Date(timestamp));
            }
            if (typeof invoice.createdDate === 'string') {
                const parsed = parseMonthFromDateStr(invoice.createdDate);
                if (parsed) return parsed;
            }
            return currentMonthKey();
        }

        function getCurrentMonthInvoices() {
            const currentKey = currentMonthKey();
            return invoicesData.filter(inv => getInvoiceMonthKey(inv) === currentKey);
        }

        function getCurrentMonthRequestForRoom(roomDocId) {
            const currentKey = currentMonthKey();
            return (paymentRequestsData || [])
                .filter(req => req.roomDocId === roomDocId && getInvoiceMonthKey(req) === currentKey)
                .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0] || null;
        }

        function getCurrentRevenueSummary() {
            const summary = { expected: 0, paid: 0 };
            roomsData.forEach(room => {
                if (room.status !== 'Đang thuê') return;
                const details = getRoomTotalDetails(room);
                summary.expected += details.currentTotal;
                if (room.paymentStatus === 'Đã thanh toán') summary.paid += details.currentTotal;
            });
            return summary;
        }

        function getOutstandingDebt() {
            return roomsData.reduce((sum, room) => sum + getRoomCommittedDebt(room), 0);
        }

        function getRecordedRevenue() {
            return invoicesData.filter(invoice => invoice.status === 'Đã thanh toán')
                .reduce((sum, invoice) => sum + Math.max(0, parseNum(invoice.total)), 0);
        }

        function getDebtHistoryRows() {
            const rows = [];
            roomsData.forEach(room => {
                (Array.isArray(room.debtHistory) ? room.debtHistory : []).forEach(item => {
                    const amount = Math.max(0, parseNum(item.amount));
                    if (amount > 0) rows.push({ month: item.month || '--', roomName: room.name, amount });
                });
            });
            return rows.sort((a, b) => String(b.month).localeCompare(String(a.month)));
        }

        function renderDebtHistory() {
            const container = document.getElementById('debt-history-report');
            if (!container) return;
            const rows = getDebtHistoryRows();
            if (!rows.length) {
                container.innerHTML = '<p class="text-center text-xs text-slate-400 py-3">Chưa có khoản nợ được chốt theo tháng.</p>';
                return;
            }
            const grouped = {};
            rows.forEach(row => {
                if (!grouped[row.month]) grouped[row.month] = { total: 0, rooms: [] };
                grouped[row.month].total += row.amount;
                grouped[row.month].rooms.push(row);
            });
            container.innerHTML = `<table class="w-full text-left text-xs border border-slate-200 rounded-lg overflow-hidden">
                <thead class="bg-slate-50 text-slate-700 font-bold"><tr><th class="p-2.5">Tháng</th><th class="p-2.5">Phòng</th><th class="p-2.5 text-right">Công nợ chốt</th></tr></thead>
                <tbody class="divide-y divide-slate-100">${Object.keys(grouped).map(month => grouped[month].rooms.map(row =>
                `<tr><td class="p-2.5">${esc(month)}</td><td class="p-2.5">${esc(row.roomName)}</td><td class="p-2.5 text-right font-semibold text-rose-600">${row.amount.toLocaleString('vi-VN')} đ</td></tr>`
            ).join('') + `<tr class="bg-rose-50/50 font-bold"><td class="p-2.5" colspan="2">Tổng ${esc(month)}</td><td class="p-2.5 text-right text-rose-600">${grouped[month].total.toLocaleString('vi-VN')} đ</td></tr>`).join('')}</tbody>
            </table>`;
        }

        function renderOverviewAnalytics() {
            const monthlyData = getMonthlyRevenueData();
            const sortedMonths = Object.keys(monthlyData).sort((a, b) => {
                let [m1, y1] = a.split('/').map(Number);
                let [m2, y2] = b.split('/').map(Number);
                return (y1 - y2) || (m1 - m2);
            });

            const labels = sortedMonths;
            const expectedData = labels.map(m => monthlyData[m].expected);
            const paidData = labels.map(m => monthlyData[m].paid);

            const ctx = document.getElementById('revenueChart')?.getContext('2d');
            if (ctx) {
                if (revenueChartInstance) revenueChartInstance.destroy();

                revenueChartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [
                            {
                                label: 'Doanh thu dự kiến',
                                data: expectedData,
                                backgroundColor: '#94a3b8',
                                borderRadius: 4
                            },
                            {
                                label: 'Doanh thu thực thu',
                                data: paidData,
                                backgroundColor: '#4f46e5',
                                borderRadius: 4
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'bottom', labels: { font: { size: 11 } } },
                            tooltip: {
                                callbacks: {
                                    label: function (context) {
                                        let label = context.dataset.label || '';
                                        if (label) label += ': ';
                                        if (context.parsed.y !== null) {
                                            label += context.parsed.y.toLocaleString('vi-VN') + ' đ';
                                        }
                                        return label;
                                    }
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    font: { size: 10 },
                                    callback: function (value) {
                                        return (value / 1000000).toFixed(1) + ' Tr';
                                    }
                                }
                            },
                            x: {
                                ticks: { font: { size: 10 } }
                            }
                        }
                    }
                });
            }

            const select1 = document.getElementById('compare-month-1');
            const select2 = document.getElementById('compare-month-2');

            if (select1 && select2) {
                const prev1 = select1.value;
                const prev2 = select2.value;

                select1.innerHTML = sortedMonths.map(m => `<option value="${m}">${m}</option>`).join('');
                select2.innerHTML = sortedMonths.map(m => `<option value="${m}">${m}</option>`).join('');

                if (sortedMonths.length > 0) {
                    select1.value = prev1 && sortedMonths.includes(prev1) ? prev1 : sortedMonths[Math.max(0, sortedMonths.length - 2)];
                    select2.value = prev2 && sortedMonths.includes(prev2) ? prev2 : sortedMonths[sortedMonths.length - 1];
                }
            }

            renderRevenueComparison();
            renderDebtHistory();
            const debtEl = document.getElementById('stat-debt');
            if (debtEl) debtEl.innerText = getOutstandingDebt().toLocaleString('vi-VN') + ' đ';
            const revenueEl = document.getElementById('stat-total-revenue');
            if (revenueEl) revenueEl.innerText = getRecordedRevenue().toLocaleString('vi-VN') + ' đ';
        }

        window.renderRevenueComparison = function () {
            const m1 = document.getElementById('compare-month-1')?.value;
            const m2 = document.getElementById('compare-month-2')?.value;

            document.getElementById('th-month-1').innerText = m1 ? `Tháng ${m1}` : 'Tháng 1';
            document.getElementById('th-month-2').innerText = m2 ? `Tháng ${m2}` : 'Tháng 2';

            const monthlyData = getMonthlyRevenueData();
            const data1 = monthlyData[m1] || { expected: 0, paid: 0 };
            const data2 = monthlyData[m2] || { expected: 0, paid: 0 };

            const diffPaid = data2.paid - data1.paid;
            const diffExpected = data2.expected - data1.expected;

            const tbody = document.getElementById('comparison-table-body');
            if (!tbody) return;

            const formatDiff = (diff) => {
                if (diff > 0) return `<span class="text-emerald-600 font-bold">+${diff.toLocaleString('vi-VN')} đ <i class="fa-solid fa-arrow-trend-up"></i></span>`;
                if (diff < 0) return `<span class="text-rose-600 font-bold">${diff.toLocaleString('vi-VN')} đ <i class="fa-solid fa-arrow-trend-down"></i></span>`;
                return `<span class="text-slate-400 font-bold">0 đ</span>`;
            };

            tbody.innerHTML = `
                <tr>
                    <td class="p-2.5 font-medium">Doanh Thu Thực Thu</td>
                    <td class="p-2.5 text-right font-bold text-indigo-600">${data1.paid.toLocaleString('vi-VN')} đ</td>
                    <td class="p-2.5 text-right font-bold text-indigo-600">${data2.paid.toLocaleString('vi-VN')} đ</td>
                    <td class="p-2.5 text-right">${formatDiff(diffPaid)}</td>
                </tr>
                <tr>
                    <td class="p-2.5 font-medium">Doanh Thu Dự Kiến</td>
                    <td class="p-2.5 text-right font-bold text-slate-700">${data1.expected.toLocaleString('vi-VN')} đ</td>
                    <td class="p-2.5 text-right font-bold text-slate-700">${data2.expected.toLocaleString('vi-VN')} đ</td>
                    <td class="p-2.5 text-right">${formatDiff(diffExpected)}</td>
                </tr>
            `;
        };

        async function loadAllData() {
            try {
                const dbRef = ref(db);

                const roomSnap = await get(child(dbRef, "rooms"));
                roomsData = [];
                if (roomSnap.exists()) {
                    const data = roomSnap.val();
                    Object.keys(data).slice(0, MAX_ROOMS).forEach(k => roomsData.push({ docId: k, ...data[k] }));

                    const normalizeTasks = [];
                    roomsData.forEach(room => {
                        const original = JSON.stringify({
                            name: room.name,
                            status: room.status,
                            tenant: room.tenant,
                            occupants: room.occupants,
                            phone: room.phone,
                            paymentStatus: room.paymentStatus,
                            debt: room.debt
                        });

                        room.name = boundedText(room.name, 100);

                        const hasTenantInfo = Boolean(String(room.tenant || '').trim()) || parseNum(room.occupants) > 0 || Boolean(String(room.phone || '').trim());
                        if (room.status !== 'Đang thuê' && hasTenantInfo) {
                            room.status = 'Đang thuê';
                        } else {
                            room.status = room.status === 'Đang thuê' ? 'Đang thuê' : 'Trống';
                        }

                        if (room.status === 'Trống') {
                            if (!hasTenantInfo) {
                                room.tenant = '';
                                room.occupants = 0;
                                room.phone = '';
                                room.paymentStatus = 'Chưa thanh toán';
                                room.debt = 0;
                            }
                        } else if (room.status === 'Đang thuê') {
                            room.tenant = boundedText(room.tenant, 150);
                            room.occupants = Math.max(1, parseNum(room.occupants));
                            room.previousMonthDebt = Math.max(0, parseNum(room.previousMonthDebt ?? room.debt));
                        room.debt = room.previousMonthDebt;
                        }
                        room.phone = boundedText(room.phone, 30);
                        room.note = boundedText(room.note);
                        room.contractNumber = boundedText(room.contractNumber, 100);
                        room.deposit = Math.max(0, parseNum(room.deposit));
                        room.startDate = typeof room.startDate === 'string' ? room.startDate.slice(0, 10) : '';
                        room.endDate = typeof room.endDate === 'string' ? room.endDate.slice(0, 10) : '';
                        room.debtHistory = Array.isArray(room.debtHistory) ? room.debtHistory.slice(-120) : [];

                        const normalized = JSON.stringify({
                            name: room.name,
                            status: room.status,
                            tenant: room.tenant,
                            occupants: room.occupants,
                            phone: room.phone,
                            paymentStatus: room.paymentStatus,
                            debt: room.debt
                        });

                        if (original !== normalized) {
                            normalizeTasks.push(set(ref(db, 'rooms/' + room.docId), room));
                        }
                    });
                    if (normalizeTasks.length) await Promise.all(normalizeTasks);

                    sortRooms(roomsData);
                }

                const issuesSnap = await get(child(dbRef, "issues"));
                issuesData = [];
                if (issuesSnap.exists()) {
                    const data = issuesSnap.val();
                    Object.keys(data).slice(0, MAX_COLLECTION_ITEMS).forEach(k => issuesData.push({ id: k, ...data[k] }));
                }
                updateIssueBadge();

                const invoicesSnap = await get(child(dbRef, "invoices"));
                invoicesData = [];
                if (invoicesSnap.exists()) {
                    const data = invoicesSnap.val();
                    Object.keys(data).slice(0, MAX_COLLECTION_ITEMS).forEach(k => invoicesData.push({ id: k, ...data[k] }));
                }

                const requestSnap = await get(child(dbRef, "invoiceRequests"));
                paymentRequestsData = [];
                if (requestSnap.exists()) {
                    const data = requestSnap.val();
                    Object.keys(data).slice(0, MAX_COLLECTION_ITEMS).forEach(k => paymentRequestsData.push({ id: k, ...data[k] }));
                }
                updatePaymentRequestBadge();

                const chatSnap = await get(child(dbRef, "chats"));
                chatsData = {};
                if (chatSnap.exists()) {
                    const rawChats = chatSnap.val();
                    Object.keys(rawChats).forEach(roomDocId => {
                        chatsData[roomDocId] = [];
                        const roomMsgs = rawChats[roomDocId];
                        if (!roomMsgs || typeof roomMsgs !== 'object') return;
                        Object.keys(roomMsgs).slice(0, MAX_COLLECTION_ITEMS).forEach(msgId => {
                            const msg = roomMsgs[msgId];
                            chatsData[roomDocId].push({ id: msgId, ...msg, text: boundedText(msg.text) });
                        });
                        chatsData[roomDocId].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                    });
                }
                updateChatBadge();

                const archivesSnap = await get(child(dbRef, ARCHIVE_PATH));
                archiveSnapshotsData = [];
                if (archivesSnap.exists()) {
                    const rawArchives = archivesSnap.val();
                    Object.keys(rawArchives).slice(0, 50).forEach(key => {
                        const item = rawArchives[key];
                        if (!item) return;
                        archiveSnapshotsData.push({ id: key, ...item });
                    });
                    archiveSnapshotsData.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                }
                renderArchiveList();

                renderOverviewAnalytics();
            } catch (err) {
                hideLoading();
                notifyError(err, 'Không thể tải dữ liệu');
            }
        }

        function listenToRoomChat(roomDocId, callback) {
            const chatRef = ref(db, 'chats/' + roomDocId);
            onValue(chatRef, (snapshot) => {
                const msgs = [];
                if (snapshot.exists()) {
                    const data = snapshot.val();
                    Object.keys(data).slice(0, MAX_COLLECTION_ITEMS).forEach(msgId => {
                        const m = data[msgId];
                        msgs.push({ id: msgId, ...m, text: boundedText(m.text) });
                    });
                    msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                }
                chatsData[roomDocId] = msgs;
                callback(msgs);
                updateChatBadge();
            });
        }

        function updateIssueBadge() {
            const unhandled = issuesData.filter(i => !i.resolved).length;
            const badge = document.getElementById('badge-issues');
            if (unhandled > 0) {
                badge.innerText = unhandled;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }

        function normalizeSearchText(value) {
            return String(value ?? '')
                .trim()
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9\s]/g, '')
                .replace(/\s+/g, ' ');
        }

        function updateChatBadge() {
            let totalUnread = 0;
            Object.keys(chatsData).forEach(roomDocId => {
                const msgs = chatsData[roomDocId] || [];
                const lastMsg = msgs[msgs.length - 1];
                if (lastMsg && lastMsg.sender === 'tenant') {
                    totalUnread++;
                }
            });
            const badge = document.getElementById('badge-chats');
            if (badge) {
                if (totalUnread > 0) {
                    badge.innerText = totalUnread;
                    badge.classList.remove('hidden');
                } else {
                    badge.classList.add('hidden');
                }
            }
        }

        window.searchRoomForTenant = function () {
            const rawKw = document.getElementById('search-keyword').value;
            const kw = normalizeSearchText(rawKw);
            if (!kw) return Swal.fire({ title: 'Thông báo', text: 'Vui lòng nhập tên phòng hoặc SĐT', icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });

            const found = roomsData.find(r => {
                const roomName = normalizeSearchText(r.name);
                const roomTenant = normalizeSearchText(r.tenant);
                const roomPhone = normalizeSearchText(r.phone);
                return roomName.includes(kw) || roomTenant.includes(kw) || roomPhone.includes(kw);
            });

            if (!found) return Swal.fire({ title: 'Lỗi', text: 'Không tìm thấy thông tin phòng!', icon: 'error', customClass: { popup: 'rounded-xl text-xs' } });
            activeTenantRoom = found;
            displayTenantInfo(found);
        };

        function displayTenantInfo(room) {
            const details = getRoomTotalDetails(room);
            const now = new Date();
            const currentMonthStr = `${now.getMonth() + 1}/${now.getFullYear()}`;

            document.getElementById('t-room-name').innerText = room.name;
            document.getElementById('t-tenant-name').innerText = room.tenant || 'Chưa cập nhật';
            document.getElementById('t-occupants').innerText = room.occupants || 1;
            const contractInfo = document.getElementById('t-contract-info');
            const contractParts = [];
            if (room.contractNumber) contractParts.push(`HĐ: ${room.contractNumber}`);
            if (parseNum(room.deposit) > 0) contractParts.push(`Cọc: ${parseNum(room.deposit).toLocaleString('vi-VN')} đ`);
            if (room.startDate || room.endDate) contractParts.push(`${room.startDate || '--'} → ${room.endDate || '--'}`);
            contractInfo.innerText = contractParts.join(' • ');
            contractInfo.classList.toggle('hidden', contractParts.length === 0);

            const isPaid = room.paymentStatus === "Đã thanh toán";
            const badge = document.getElementById('t-payment-status-badge');
            badge.innerText = isPaid ? "Đã thanh toán" : "Chưa thanh toán";
            badge.className = isPaid ? "px-2.5 py-1 text-xs rounded-md font-semibold bg-emerald-50 text-emerald-600 border border-emerald-100" : "px-2.5 py-1 text-xs rounded-md font-semibold bg-rose-50 text-rose-600 border border-rose-100";

            document.getElementById('t-price').innerText = details.price.toLocaleString('vi-VN') + ' đ';
            document.getElementById('t-elec-qty').innerText = details.elecQty;
            document.getElementById('t-elec-total').innerText = details.elecTotal.toLocaleString('vi-VN') + ' đ';
            document.getElementById('t-water-total').innerText = details.waterTotal.toLocaleString('vi-VN') + ' đ';
            document.getElementById('t-water-desc').innerText = details.waterQtyDesc;
            document.getElementById('t-service').innerText = details.service.toLocaleString('vi-VN') + ' đ';
            document.getElementById('t-debt').innerText = details.debt.toLocaleString('vi-VN') + ' đ';
            document.getElementById('tenant-debt-row').classList.toggle('hidden', details.debt <= 0);
            document.getElementById('t-total').innerText = details.total.toLocaleString('vi-VN') + ' đ';

            const rejectionNotice = document.getElementById('tenant-rejection-notice');
            const rejectionReasonEl = document.getElementById('t-rejection-reason');

            activeInvoiceRequest = getCurrentMonthRequestForRoom(room.docId);

            if (activeInvoiceRequest && activeInvoiceRequest.status === 'rejected') {
                rejectionNotice.classList.remove('hidden');
                rejectionReasonEl.innerText = activeInvoiceRequest.rejectionReason || 'Không có lý do cụ thể.';
            } else {
                rejectionNotice.classList.add('hidden');
            }

            const actionBtn = document.getElementById('tenant-invoice-action');
            const existingInvoice = findInvoiceForRequest(activeInvoiceRequest, room);
            if (existingInvoice) {
                actionBtn.innerHTML = '<i class="fa-solid fa-lock"></i> Đã in - Liên hệ Chủ Trọ';
                actionBtn.onclick = null;
                actionBtn.disabled = true;
                actionBtn.title = 'Hóa đơn đã có trong lịch sử. Chỉ Chủ Trọ được phép in lại.';
                actionBtn.className = 'bg-slate-300 text-slate-600 text-[11px] font-semibold py-2.5 px-2 rounded-lg shadow-xs flex items-center justify-center gap-1 cursor-not-allowed';
            } else if (activeInvoiceRequest?.status === 'approved' && isPaid) {
                actionBtn.innerHTML = '<i class="fa-solid fa-print"></i> In Hóa Đơn';
                actionBtn.onclick = (e) => printInvoice(e);
                actionBtn.disabled = false;
                actionBtn.title = '';
                actionBtn.className = 'bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold py-2.5 px-2 rounded-lg shadow-xs flex items-center justify-center gap-1 transition-all active:scale-95';
            } else if (activeInvoiceRequest?.status === 'pending') {
                actionBtn.innerHTML = '<i class="fa-solid fa-clock"></i> Chờ Admin';
                actionBtn.onclick = (e) => requestInvoice(e);
                actionBtn.disabled = false;
                actionBtn.title = '';
                actionBtn.className = 'bg-slate-400 text-white text-[11px] font-semibold py-2.5 px-2 rounded-lg shadow-xs flex items-center justify-center gap-1 cursor-not-allowed';
            } else {
                actionBtn.innerHTML = '<i class="fa-solid fa-file-circle-plus"></i> Yêu cầu HĐ';
                actionBtn.onclick = (e) => requestInvoice(e);
                actionBtn.disabled = false;
                actionBtn.title = '';
                actionBtn.className = 'bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold py-2.5 px-2 rounded-lg shadow-xs flex items-center justify-center gap-1 transition-all active:scale-95';
            }

            const paymentBox = document.getElementById('tenant-payment-box');
            if (isPaid) {
                paymentBox.innerHTML = `<div class="text-xs text-center text-emerald-600 font-semibold py-2"><i class="fa-solid fa-circle-check text-base"></i><br>Đã được Chủ Trọ xác nhận thanh toán.</div>`;
            } else {
                const memo = `${room.name} THANH TOAN TIEN TRO THANG ${currentMonthStr}`;
                const qrUrl = `https://api.vietqr.io/image/${BANK_CONFIG.bankBin}-${BANK_CONFIG.accountNo}-compact2.jpg?amount=${details.total}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(BANK_CONFIG.accountName)}`;
                paymentBox.innerHTML = `
                    <div class="text-center space-y-2">
                        <p class="text-xs font-bold text-slate-700">Mã QR Chuyển Khoản Techcombank</p>
                        <img src="${esc(qrUrl)}" class="w-48 h-48 mx-auto border border-slate-100 p-1 rounded-lg shadow-xs object-contain">
                        <div class="bg-slate-50 p-3 rounded-lg text-xs text-left border border-slate-200 space-y-1">
                            <p><strong>Chủ tài khoản:</strong> ${esc(BANK_CONFIG.accountName)}</p>
                            <p><strong>Số tài khoản:</strong> ${esc(BANK_CONFIG.accountNo)}</p>
                            <p class="text-indigo-600 font-semibold"><strong>Nội dung:</strong> ${esc(memo)}</p>
                        </div>
                        <p class="text-[11px] text-amber-700 font-medium">Sau khi chuyển khoản hoặc nộp tiền mặt, hãy bấm “Yêu cầu HĐ” để báo Chủ Trọ kiểm tra.</p>
                    </div>
                `;
            }
            document.getElementById('tenant-result').classList.remove('hidden');
        }

        window.openTenantChatModal = function () {
            if (!activeTenantRoom) return;
            document.getElementById('chat-modal-room-name').innerText = activeTenantRoom.name;
            document.getElementById('tenantChatModal').classList.remove('hidden');
            listenToRoomChat(activeTenantRoom.docId, renderTenantChatMessages);
        };

        window.closeTenantChatModal = function () {
            document.getElementById('tenantChatModal').classList.add('hidden');
        };

        function renderTenantChatMessages(msgs) {
            const container = document.getElementById('tenant-chat-messages');
            if (!container) return;
            if (msgs.length === 0) {
                container.innerHTML = `<div class="text-center text-slate-400 my-auto py-8 text-xs">Chưa có tin nhắn nào. Hãy gửi tin nhắn cho chủ trọ!</div>`;
                return;
            }
            container.innerHTML = msgs.map(m => {
                const isAdmin = m.sender === 'admin';
                return `
                    <div class="flex flex-col ${isAdmin ? 'items-start' : 'items-end'} mb-2 group">
                        <div class="flex items-center gap-1.5 mb-0.5">
                            <span class="text-[10px] text-slate-400">${isAdmin ? 'Chủ Trọ' : esc(activeTenantRoom.tenant || 'Bạn')} • ${new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            <button onclick="deleteSingleMessage('${activeTenantRoom.docId}', '${m.id}')" class="text-rose-400 hover:text-rose-600 text-[10px] opacity-0 group-hover:opacity-150 transition-opacity" title="Xóa tin nhắn">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                        <div class="max-w-[80%] p-2.5 rounded-xl text-xs ${isAdmin ? 'bg-white text-slate-800 border border-slate-200' : 'bg-cyan-600 text-white'}">
                            ${m.text ? `<div>${esc(m.text)}</div>` : ''}
                            ${imagePreviewHtml(m.image)}
                        </div>
                    </div>
                `;
            }).join('');
            container.scrollTop = container.scrollHeight;
        }

        window.sendTenantMessage = async function () {
            const input = document.getElementById('tenant-chat-input');
            const imageInput = document.getElementById('tenant-chat-image');
            const text = boundedText(input.value);
            if ((!text && !imageInput?.files?.length) || !activeTenantRoom) return;

            await executeWithLock(null, async () => {
                const image = await readImageAsDataUrl(imageInput.files[0]);
                const msgId = 'msg_' + Date.now();
                const msgObj = {
                    sender: 'tenant',
                    senderName: activeTenantRoom.tenant || 'Khách thuê',
                    text: text,
                    image,
                    timestamp: Date.now()
                };
                assertRecordSize(msgObj);
                await set(ref(db, `chats/${activeTenantRoom.docId}/${msgId}`), msgObj);
                input.value = '';
                imageInput.value = '';
            });
        };

        function renderAdminChatRoomList() {
            const listContainer = document.getElementById('admin-chat-room-list');
            if (!listContainer) return;

            const rentedRooms = roomsData.filter(r => r.status === 'Đang thuê');
            if (rentedRooms.length === 0) {
                listContainer.innerHTML = `<p class="text-xs text-slate-400 text-center py-4">Không có phòng nào đang thuê.</p>`;
                return;
            }

            listContainer.innerHTML = rentedRooms.map(room => {
                const msgs = chatsData[room.docId] || [];
                const lastMsg = msgs[msgs.length - 1];
                const isSelected = selectedAdminChatRoomId === room.docId;
                const hasUnread = lastMsg && lastMsg.sender === 'tenant';

                return `
                    <div onclick="selectAdminChatRoom('${room.docId}')" class="p-2.5 rounded-lg cursor-pointer transition-all border ${isSelected ? 'bg-indigo-50 border-indigo-200 shadow-xs' : 'bg-white border-slate-200 hover:bg-slate-100'}">
                        <div class="flex justify-between items-center">
                            <span class="font-bold text-slate-800 text-xs">${esc(room.name)}</span>
                            ${hasUnread ? '<span class="w-2 h-2 rounded-full bg-rose-500"></span>' : ''}
                        </div>
                        <p class="text-[11px] text-slate-500 truncate mt-0.5">${esc(room.tenant || 'Khách')} ${lastMsg ? '• ' + esc(lastMsg.text) : ''}</p>
                    </div>
                `;
            }).join('');
        }

        window.selectAdminChatRoom = function (roomDocId) {
            selectedAdminChatRoomId = roomDocId;
            renderAdminChatRoomList();
            const room = roomsData.find(r => r.docId === roomDocId);
            const container = document.getElementById('admin-chat-box-container');

            if (!room) return;

            container.innerHTML = `
                <div class="flex justify-between items-center border-b border-slate-200 pb-2 mb-2">
                    <div>
                        <h4 class="font-bold text-xs text-slate-900">${esc(room.name)} - ${esc(room.tenant || 'Khách thuê')}</h4>
                        <p class="text-[10px] text-slate-500">SĐT: ${esc(room.phone || 'Chưa cập nhật')}</p>
                    </div>
                    <span class="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded font-semibold border border-indigo-100">Đang trò chuyện</span>
                </div>
                <div id="admin-chat-messages-scroll" class="flex-1 overflow-y-auto space-y-2 p-2 bg-slate-50/50 rounded-xl border border-slate-100 text-xs mb-2"></div>
                <div class="flex gap-2">
                    <input type="text" id="admin-chat-input" placeholder="Nhập tin nhắn trả lời..."
                        class="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg outline-none focus:border-indigo-600 bg-white"
                        onkeypress="if(event.key==='Enter') sendAdminMessage()">
                    <label class="bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-lg text-xs cursor-pointer" title="Gửi hình ảnh">
                        <i class="fa-solid fa-image"></i>
                        <input type="file" id="admin-chat-image" accept="image/*" class="hidden">
                    </label>
                    <button onclick="sendAdminMessage()"
                        class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-xs font-semibold shadow-xs transition-all active:scale-95">
                        <i class="fa-solid fa-paper-plane"></i> Gửi
                    </button>
                </div>
            `;

            listenToRoomChat(roomDocId, (msgs) => {
                const scrollBox = document.getElementById('admin-chat-messages-scroll');
                if (!scrollBox) return;
                if (msgs.length === 0) {
                    scrollBox.innerHTML = `<div class="text-center text-slate-400 my-auto py-12 text-xs">Chưa có tin nhắn nào từ phòng này.</div>`;
                    return;
                }
                scrollBox.innerHTML = msgs.map(m => {
                    const isAdmin = m.sender === 'admin';
                    return `
                        <div class="flex flex-col ${isAdmin ? 'items-end' : 'items-start'} mb-2 group">
                            <div class="flex items-center gap-1.5 mb-0.5">
                                <button onclick="deleteSingleMessage('${roomDocId}', '${m.id}')" class="text-rose-400 hover:text-rose-600 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity" title="Xóa tin nhắn">
                                    <i class="fa-solid fa-trash-can"></i>
                                </button>
                                <span class="text-[10px] text-slate-400">${isAdmin ? 'Bạn (Chủ Trọ)' : esc(room.tenant)} • ${new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            <div class="max-w-[80%] p-2.5 rounded-xl text-xs ${isAdmin ? 'bg-indigo-600 text-white' : 'bg-white text-slate-800 border border-slate-200'}">
                                ${m.text ? `<div>${esc(m.text)}</div>` : ''}
                                ${imagePreviewHtml(m.image)}
                            </div>
                        </div>
                    `;
                }).join('');
                scrollBox.scrollTop = scrollBox.scrollHeight;
            });
        };

        window.sendAdminMessage = async function () {
            const input = document.getElementById('admin-chat-input');
            const imageInput = document.getElementById('admin-chat-image');
            const text = boundedText(input.value);
            if ((!text && !imageInput?.files?.length) || !selectedAdminChatRoomId) return;

            await executeWithLock(null, async () => {
                const image = await readImageAsDataUrl(imageInput.files[0]);
                const msgId = 'msg_' + Date.now();
                const msgObj = {
                    sender: 'admin',
                    senderName: 'Chủ Trọ',
                    text: text,
                    image,
                    timestamp: Date.now()
                };
                assertRecordSize(msgObj);
                await set(ref(db, `chats/${selectedAdminChatRoomId}/${msgId}`), msgObj);
                input.value = '';
                imageInput.value = '';
                renderAdminChatRoomList();
            });
        };

        // Chức năng xóa một tin nhắn cụ thể
        window.deleteSingleMessage = async function (roomDocId, msgId) {
            const res = await Swal.fire({
                title: 'Xóa tin nhắn này?',
                text: 'Tin nhắn sẽ bị xóa vĩnh viễn khỏi CSDL.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#e11d48',
                confirmButtonText: 'Xóa',
                cancelButtonText: 'Hủy',
                customClass: { popup: 'rounded-xl text-xs' }
            });

            if (res.isConfirmed) {
                await remove(ref(db, `chats/${roomDocId}/${msgId}`));
                Toast.fire({ icon: 'success', title: 'Đã xóa tin nhắn!' });
            }
        };

        // Chức năng xóa sạch toàn bộ lịch sử tin nhắn trong CSDL
        window.clearAllChatsDatabase = async function (evt) {
            const btn = evt?.currentTarget || evt?.target;
            const res = await Swal.fire({
                title: 'Làm sạch toàn bộ CSDL Tin Nhắn?',
                text: 'Tất cả lịch sử trò chuyện của mọi phòng sẽ bị xóa vĩnh viễn để giải phóng CSDL!',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#e11d48',
                confirmButtonText: 'Xóa tất cả',
                cancelButtonText: 'Hủy',
                customClass: { popup: 'rounded-xl text-xs' }
            });

            if (res.isConfirmed) {
                await executeWithLock(btn, async () => {
                    showLoading();
                    await remove(ref(db, 'chats'));
                    chatsData = {};
                    if (selectedAdminChatRoomId) {
                        selectAdminChatRoom(selectedAdminChatRoomId);
                    }
                    renderAdminChatRoomList();
                    hideLoading();
                    Toast.fire({ icon: 'success', title: 'Đã làm sạch toàn bộ CSDL tin nhắn!' });
                });
            }
        };

        window.requestInvoice = async function (evt) {
            if (!activeTenantRoom) return;
            const btn = evt?.currentTarget || evt?.target;
            const room = activeTenantRoom;

            const occupants = Number(room.occupants || 0);
            const isEmptyRoom =
                room.status === 'Trống' ||
                !String(room.tenant || '').trim() ||
                occupants <= 0;

            if (isEmptyRoom) {
                return Swal.fire({ title: 'Không thể yêu cầu', text: 'Phòng hiện không có người thuê nên không thể yêu cầu xuất hóa đơn.', icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
            }

            const existing = paymentRequestsData
                .filter(r => r.roomDocId === room.docId && r.status === 'pending' && getInvoiceMonthKey(r) === currentMonthKey())
                .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0];

            if (existing) {
                return Swal.fire({ title: 'Đã gửi yêu cầu', text: 'Yêu cầu của phòng đang chờ Chủ Trọ kiểm tra và xác nhận.', icon: 'info', customClass: { popup: 'rounded-xl text-xs' } });
            }

            if (room.paymentStatus === 'Đã thanh toán') {
                return Swal.fire({ title: 'Thông báo', text: 'Phòng đã được Chủ Trọ xác nhận thanh toán. Hãy chờ/kiểm tra quyền in hóa đơn.', icon: 'info', customClass: { popup: 'rounded-xl text-xs' } });
            }

            const result = await Swal.fire({
                title: 'Yêu cầu xuất hóa đơn',
                text: 'Bạn đã thanh toán bằng hình thức nào?',
                input: 'select',
                inputOptions: {
                    'Chuyển khoản QR': 'Chuyển khoản QR',
                    'Tiền mặt': 'Tiền mặt'
                },
                inputPlaceholder: 'Chọn phương thức thanh toán',
                showCancelButton: true,
                confirmButtonText: 'Gửi yêu cầu',
                cancelButtonText: 'Hủy',
                confirmButtonColor: '#4f46e5',
                customClass: { popup: 'rounded-xl text-xs' },
                inputValidator: value => !value ? 'Vui lòng chọn phương thức thanh toán' : undefined
            });

            if (!result.isConfirmed) return;

            await executeWithLock(btn, async () => {
                showLoading();
                const requestId = 'req_' + Date.now();
                const request = {
                    id: requestId,
                    roomDocId: room.docId,
                    roomName: boundedText(room.name, 100),
                    tenantName: boundedText(room.tenant || 'Khách', 150),
                    phone: boundedText(room.phone, 30),
                    total: getRoomTotalDetails(room).total,
                    paymentMethod: result.value,
                    status: 'pending',
                    createdAt: Date.now(),
                    createdDate: new Date().toLocaleString('vi-VN')
                };
                assertRecordSize(request);
                await set(ref(db, 'invoiceRequests/' + requestId), request);
                await loadAllData();
                activeInvoiceRequest = request;
                displayTenantInfo(room);
                hideLoading();
                Toast.fire({ icon: 'success', title: 'Đã gửi yêu cầu cho Chủ Trọ!' });
            });
        };

        window.printInvoice = async function (evt) {
            if (!activeTenantRoom) return;
            const btn = evt?.currentTarget || evt?.target;
            const room = activeTenantRoom;

            const occupants = Number(room.occupants || 0);
            const isEmptyRoom =
                room.status === 'Trống' ||
                !String(room.tenant || '').trim() ||
                occupants <= 0;

            if (isEmptyRoom) {
                return Swal.fire({ title: 'Không thể in hóa đơn', text: 'Phòng hiện không có người thuê.', icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
            }

            const request = getCurrentMonthRequestForRoom(room.docId);

            if (room.paymentStatus !== 'Đã thanh toán' || !request || request.status !== 'approved') {
                return Swal.fire({ title: 'Chưa được phép in', text: 'Khách phải thanh toán trước và Chủ Trọ phải xác nhận yêu cầu xuất hóa đơn.', icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
            }

            const details = getRoomTotalDetails(room);
            const existingInvoice = findInvoiceForRequest(request, room);
            if (existingInvoice) {
                return Swal.fire({
                    title: 'Hóa đơn đã được in',
                    text: 'Hóa đơn này đã có trong lịch sử. Chỉ Chủ Trọ mới có thể in lại.',
                    icon: 'info',
                    customClass: { popup: 'rounded-xl text-xs' }
                });
            }

            preparePrintArea({
                roomName: room.name,
                tenantName: room.tenant,
                occupants: room.occupants,
                price: details.price,
                elecQty: details.elecQty,
                elecTotal: details.elecTotal,
                waterTotal: details.waterTotal,
                waterQtyDesc: details.waterQtyDesc,
                service: details.service,
                debt: details.debt,
                total: details.total,
                status: room.paymentStatus,
                createdDate: new Date().toLocaleString('vi-VN')
            });

            await executeWithLock(btn, async () => {
                if (existingInvoice) {
                    window.print();
                    return;
                }

                showLoading();
                const invoiceId = 'inv_' + Date.now();
                const invoiceData = {
                    id: invoiceId,
                    requestId: request.id,
                    roomName: room.name,
                    tenantName: room.tenant || 'Chưa cập nhật',
                    occupants: room.occupants || 1,
                    price: details.price,
                    elecQty: details.elecQty,
                    elecTotal: details.elecTotal,
                    waterTotal: details.waterTotal,
                    waterQtyDesc: details.waterQtyDesc,
                    service: details.service,
                    debt: details.debt,
                    total: details.total,
                    status: room.paymentStatus || 'Chưa thanh toán',
                    createdAt: Date.now(),
                    createdDate: new Date().toLocaleString('vi-VN')
                };
                await set(ref(db, 'invoices/' + invoiceId), invoiceData);
                hideLoading();

                setTimeout(() => {
                    window.print();
                }, 200);
            });
        };

        function findInvoiceForRequest(request, room) {
            if (!request || !room) return null;
            const currentMonthInvoicesList = getCurrentMonthInvoices();
            return currentMonthInvoicesList.find(inv => inv.requestId === request.id) ||
                currentMonthInvoicesList
                    .filter(inv => inv.roomName === room.name && inv.tenantName === (room.tenant || 'Chưa cập nhật'))
                    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0] ||
                null;
        }

        function preparePrintArea(invoice) {
            document.getElementById('print-date').innerText = 'Ngày lập: ' + (invoice.createdDate || new Date().toLocaleString('vi-VN').split(' ')[0]);
            document.getElementById('p-room').innerText = invoice.roomName || '---';
            document.getElementById('p-tenant').innerText = invoice.tenantName || '---';
            document.getElementById('p-occupants').innerText = invoice.occupants || 1;
            document.getElementById('p-price').innerText = Number(invoice.price || 0).toLocaleString('vi-VN') + ' đ';
            document.getElementById('p-elec-qty').innerText = invoice.elecQty || 0;
            document.getElementById('p-elec').innerText = Number(invoice.elecTotal || 0).toLocaleString('vi-VN') + ' đ';
            document.getElementById('p-water').innerText = Number(invoice.waterTotal || 0).toLocaleString('vi-VN') + ' đ';
            document.getElementById('p-water-desc').innerText = `(${invoice.waterQtyDesc || '--'})`;
            document.getElementById('p-service').innerText = Number(invoice.service || 0).toLocaleString('vi-VN') + ' đ';
            document.getElementById('p-debt').innerText = Number(invoice.debt || 0).toLocaleString('vi-VN') + ' đ';
            document.getElementById('p-debt-row').style.display = Number(invoice.debt || 0) > 0 ? '' : 'none';
            document.getElementById('p-total').innerText = Number(invoice.total || 0).toLocaleString('vi-VN') + ' đ';
            document.getElementById('p-status').innerText = invoice.status || 'Chưa thanh toán';
        }

        function renderInvoiceHistory() {
            const container = document.getElementById('invoice-history-cards');
            const currentInvoices = getCurrentMonthInvoices();
            if (currentInvoices.length === 0) {
                container.innerHTML = `<p class="text-center text-xs text-slate-400 py-4">Chưa có hóa đơn nào được lưu cho tháng này.</p>`;
                return;
            }
            const sortedInvoices = [...currentInvoices].sort((a, b) => {
                const roomNumberDifference = extractRoomNumber(a.roomName) - extractRoomNumber(b.roomName);
                if (roomNumberDifference !== 0) return roomNumberDifference;

                const roomNameDifference = String(a.roomName || '').localeCompare(String(b.roomName || ''), 'vi');
                if (roomNameDifference !== 0) return roomNameDifference;

                return Number(b.createdAt || 0) - Number(a.createdAt || 0);
            });

            container.innerHTML = sortedInvoices.map(inv => `
                <div class="p-3 border border-slate-200 rounded-xl bg-slate-50/50 space-y-1.5 text-xs">
                    <div class="flex justify-between items-center">
                        <span class="font-bold text-slate-800">${esc(inv.roomName)} - ${esc(inv.tenantName)}</span>
                        <div class="flex items-center gap-2">
                            <span class="px-2 py-0.5 text-[10px] font-semibold rounded ${inv.status === 'Đã thanh toán' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-rose-50 text-rose-600 border border-rose-100'}">${esc(inv.status)}</span>
                            <button onclick="printStoredInvoice('${inv.id}', event)" class="text-indigo-500 hover:text-indigo-700 p-1" title="In lại hóa đơn">
                                <i class="fa-solid fa-print"></i>
                            </button>
                            <button onclick="deleteSingleInvoice('${inv.id}', event)" class="text-rose-500 hover:text-rose-700 p-1" title="Xóa hóa đơn">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </div>
                    <div class="flex justify-between items-center text-slate-500">
                        <span>Ngày tạo: ${esc(inv.createdDate)}</span>
                        <span class="text-indigo-600 font-bold">${Number(inv.total).toLocaleString('vi-VN')} đ</span>
                    </div>
                </div>
            `).join('');
        }

        window.printStoredInvoice = async function (invoiceId, evt) {
            if (!adminUser) {
                return Swal.fire({ title: 'Không có quyền', text: authRequiredMessage(), icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
            }
            const btn = evt?.currentTarget || evt?.target;
            const invoice = getCurrentMonthInvoices().find(inv => inv.id === invoiceId) || invoicesData.find(inv => inv.id === invoiceId);
            if (!invoice) {
                return Swal.fire({ title: 'Không tìm thấy hóa đơn', text: 'Hóa đơn không còn tồn tại trong lịch sử.', icon: 'error', customClass: { popup: 'rounded-xl text-xs' } });
            }

            await executeWithLock(btn, async () => {
                const room = roomsData.find(item => item.name === invoice.roomName);
                const details = room ? getRoomTotalDetails(room) : null;
                preparePrintArea(details ? {
                    ...invoice,
                    occupants: invoice.occupants || room.occupants,
                    details,
                    price: invoice.price ?? details.price,
                    elecQty: invoice.elecQty ?? details.elecQty,
                    elecTotal: invoice.elecTotal ?? details.elecTotal,
                    waterTotal: invoice.waterTotal ?? details.waterTotal,
                    waterQtyDesc: invoice.waterQtyDesc || details.waterQtyDesc,
                    service: invoice.service ?? details.service,
                    debt: invoice.debt ?? details.debt,
                    total: invoice.total ?? details.total,
                    status: invoice.status || room.paymentStatus
                } : invoice);
                setTimeout(() => window.print(), 200);
            });
        };

        window.deleteSingleInvoice = async function (id, evt) {
            const btn = evt?.currentTarget || evt?.target;
            const res = await Swal.fire({
                title: 'Xóa lịch sử hóa đơn?',
                text: 'Hóa đơn này sẽ bị xóa khỏi lịch sử lưu trữ.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#e11d48',
                confirmButtonText: 'Xóa',
                cancelButtonText: 'Hủy',
                customClass: { popup: 'rounded-xl text-xs' }
            });

            if (res.isConfirmed) {
                await executeWithLock(btn, async () => {
                    showLoading();
                    await remove(ref(db, 'invoices/' + id));
                    await loadAllData();
                    renderInvoiceHistory();
                    hideLoading();
                    Toast.fire({ icon: 'success', title: 'Đã xóa hóa đơn!' });
                });
            }
        };

        window.clearAllInvoices = async function (evt) {
            const btn = evt?.currentTarget || evt?.target;
            if (invoicesData.length === 0) return Swal.fire({ title: 'Thông báo', text: 'Không có hóa đơn nào để xóa!', icon: 'info', customClass: { popup: 'rounded-xl text-xs' } });

            const res = await Swal.fire({
                title: 'Xóa toàn bộ lịch sử?',
                text: 'Tất cả các phiếu tính tiền đã lưu sẽ bị xóa vĩnh viễn!',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#e11d48',
                confirmButtonText: 'Xóa tất cả',
                cancelButtonText: 'Hủy',
                customClass: { popup: 'rounded-xl text-xs' }
            });

            if (res.isConfirmed) {
                await executeWithLock(btn, async () => {
                    showLoading();
                    await remove(ref(db, 'invoices'));
                    await loadAllData();
                    renderInvoiceHistory();
                    hideLoading();
                    Toast.fire({ icon: 'success', title: 'Đã xóa toàn bộ lịch sử hóa đơn!' });
                });
            }
        };

        function updatePaymentRequestBadge() {
            const pending = paymentRequestsData.filter(r => r.status === 'pending').length;
            const badge = document.getElementById('badge-payment-requests');
            if (!badge) return;
            badge.innerText = pending;
            badge.classList.toggle('hidden', pending === 0);
        }

        function renderPaymentRequests() {
            const container = document.getElementById('payment-requests-container');
            const pending = [...paymentRequestsData].filter(r => r.status === 'pending').reverse();
            if (pending.length === 0) {
                container.innerHTML = `<p class="text-center text-xs text-slate-400 py-4">Không có yêu cầu đang chờ xử lý.</p>`;
                return;
            }

            container.innerHTML = pending.map(req => `
                <div class="p-3.5 border border-slate-200 rounded-xl bg-slate-50/50 space-y-2 text-xs">
                    <div class="flex justify-between items-start gap-3">
                        <div>
                            <div class="font-bold text-slate-800">${esc(req.roomName)}</div>
                            <div class="text-slate-500">${esc(req.tenantName)}${req.phone ? ' - ' + esc(req.phone) : ''}</div>
                        </div>
                        <span class="px-2 py-0.5 text-[10px] font-semibold rounded bg-amber-50 text-amber-700 border border-amber-100">Chờ xác nhận</span>
                    </div>
                    <div class="text-xs space-y-1 bg-white border border-slate-200 rounded-lg p-3">
                        <p><strong>Số tiền:</strong> ${Number(req.total).toLocaleString('vi-VN')} đ</p>
                        <p><strong>Thanh toán:</strong> ${esc(req.paymentMethod)}</p>
                        <p><strong>Gửi lúc:</strong> ${esc(req.createdDate)}</p>
                    </div>
                    <div class="grid grid-cols-2 gap-2 pt-1">
                        <button onclick="approveInvoiceRequest('${req.id}', event)" class="bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg text-xs font-semibold shadow-xs">
                            <i class="fa-solid fa-circle-check mr-1"></i> Xác nhận đã nhận tiền
                        </button>
                        <button onclick="rejectInvoiceRequest('${req.id}', event)" class="bg-rose-50 hover:bg-rose-100 text-rose-700 py-2 rounded-lg text-xs font-semibold">
                            <i class="fa-solid fa-xmark mr-1"></i> Từ chối
                        </button>
                    </div>
                </div>
            `).join('');
        }

        window.approveInvoiceRequest = async function (requestId, evt) {
            const btn = evt?.currentTarget || evt?.target;
            const request = paymentRequestsData.find(r => r.id === requestId);
            if (!request) return;
            const room = roomsData.find(r => r.docId === request.roomDocId);
            if (!room) return Swal.fire({ title: 'Lỗi', text: 'Không tìm thấy phòng của yêu cầu này.', icon: 'error', customClass: { popup: 'rounded-xl text-xs' } });

            const result = await Swal.fire({
                title: 'Xác nhận đã nhận tiền?',
                text: `${request.roomName} - ${Number(request.total).toLocaleString('vi-VN')} đ`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Xác nhận',
                cancelButtonText: 'Hủy',
                confirmButtonColor: '#059669',
                customClass: { popup: 'rounded-xl text-xs' }
            });
            if (!result.isConfirmed) return;

            await executeWithLock(btn, async () => {
                showLoading();
                room.paymentStatus = 'Đã thanh toán';
                await set(ref(db, 'rooms/' + room.docId), room);

                request.status = 'approved';
                request.approvedAt = Date.now();
                request.approvedDate = new Date().toLocaleString('vi-VN');
                await set(ref(db, 'invoiceRequests/' + request.id), request);

                await loadAllData();
                renderPaymentRequests();
                renderFilteredRooms();
                if (activeTenantRoom && activeTenantRoom.docId === room.docId) {
                    activeTenantRoom = room;
                    displayTenantInfo(room);
                }
                hideLoading();
                Toast.fire({ icon: 'success', title: 'Đã xác nhận thanh toán. Khách có thể in hóa đơn.' });
            });
        };

        window.rejectInvoiceRequest = async function (requestId, evt) {
            const btn = evt?.currentTarget || evt?.target;
            const request = paymentRequestsData.find(r => r.id === requestId);
            if (!request) return;
            const result = await Swal.fire({
                title: 'Từ chối yêu cầu?',
                input: 'textarea',
                inputPlaceholder: 'Nhập lý do từ chối (bắt buộc)',
                showCancelButton: true,
                confirmButtonText: 'Từ chối',
                cancelButtonText: 'Hủy',
                confirmButtonColor: '#e11d48',
                customClass: { popup: 'rounded-xl text-xs' },
                inputValidator: value => !value ? 'Vui lòng nhập lý do từ chối để khách nắm thông tin' : undefined
            });
            if (!result.isConfirmed) return;

            await executeWithLock(btn, async () => {
                showLoading();
                request.status = 'rejected';
                request.rejectionReason = boundedText(result.value || '');
                assertRecordSize(request);
                request.rejectedAt = Date.now();
                request.rejectedDate = new Date().toLocaleString('vi-VN');
                await set(ref(db, 'invoiceRequests/' + request.id), request);
                await loadAllData();
                renderPaymentRequests();
                if (activeTenantRoom && activeTenantRoom.docId === request.roomDocId) displayTenantInfo(activeTenantRoom);
                hideLoading();
                Toast.fire({ icon: 'success', title: 'Đã từ chối yêu cầu.' });
            });
        };

        function renderAdminIssues() {
            const container = document.getElementById('admin-issues-container');
            if (issuesData.length === 0) {
                container.innerHTML = `<p class="text-center text-xs text-slate-400 py-4">Chưa có sự cố nào được báo cáo.</p>`;
                return;
            }
            container.innerHTML = issuesData.map(item => `
                <div class="p-3.5 border border-slate-200 rounded-xl bg-slate-50/50 space-y-2 text-xs">
                    <div class="flex justify-between items-start">
                        <div>
                            <span class="font-bold text-slate-800">${esc(item.roomName)}</span>
                            <span class="text-slate-500">(${esc(item.tenantName)})</span>
                        </div>
                        <span class="text-[10px] text-slate-400">${esc(item.date)}</span>
                    </div>
                    <p class="text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200">${esc(item.content)}</p>
                    ${imagePreviewHtml(item.image)}
                    <div class="flex justify-end gap-2 pt-1">
                        <button onclick="toggleIssueStatus('${item.id}', event)" class="px-3 py-1.5 rounded-lg text-xs font-semibold ${item.resolved ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-amber-50 text-amber-700 border border-amber-100'}">
                            ${item.resolved ? 'Đã xử lý' : 'Đánh dấu xong'}
                        </button>
                        <button onclick="deleteIssue('${item.id}', event)" class="bg-rose-50 text-rose-600 px-3 py-1.5 rounded-lg text-xs font-semibold">
                            Xóa
                        </button>
                    </div>
                </div>
            `).join('');
        }

        window.toggleIssueStatus = async function (issueId, evt) {
            const btn = evt?.currentTarget || evt?.target;
            const issue = issuesData.find(i => i.id === issueId);
            if (!issue) return;
            await executeWithLock(btn, async () => {
                showLoading();
                issue.resolved = !issue.resolved;
                await set(ref(db, 'issues/' + issueId), issue);
                await loadAllData();
                renderAdminIssues();
                hideLoading();
            });
        };

        window.deleteIssue = async function (issueId, evt) {
            const btn = evt?.currentTarget || evt?.target;
            await executeWithLock(btn, async () => {
                showLoading();
                await remove(ref(db, 'issues/' + issueId));
                await loadAllData();
                renderAdminIssues();
                hideLoading();
                Toast.fire({ icon: 'success', title: 'Đã xóa báo cố!' });
            });
        };

        function loadRoomsAdmin() {
            loadAllData().then(() => {
                renderFilteredRooms();
            });
        }

        window.renderFilteredRooms = function () {
            const cardsContainer = document.getElementById('room-cards-container');
            cardsContainer.innerHTML = '';
            let rentedCount = 0, emptyCount = 0, totalRevenue = 0, expectedRevenue = 0;

            const kw = normalizeSearchText(document.getElementById('admin-search-kw')?.value || '');
            const filterStatus = document.getElementById('admin-filter-status')?.value || 'all';

            const btnAdd = document.getElementById('btn-add-room');
            const roomCountBadge = document.getElementById('room-count-badge');
            if (roomCountBadge) roomCountBadge.innerText = roomsData.length;

            if (roomsData.length >= MAX_ROOMS) {
                if (btnAdd) {
                    btnAdd.disabled = true;
                    btnAdd.classList.add('opacity-50', 'cursor-not-allowed');
                }
            } else {
                if (btnAdd) {
                    btnAdd.disabled = false;
                    btnAdd.classList.remove('opacity-50', 'cursor-not-allowed');
                }
            }

            roomsData.forEach(room => {
                const details = getRoomTotalDetails(room);
                if (room.status === "Đang thuê") {
                    rentedCount++;
                    expectedRevenue += details.currentTotal;
                    if (room.paymentStatus === "Đã thanh toán") totalRevenue += details.currentTotal;
                } else emptyCount++;

                const roomName = normalizeSearchText(room.name);
                const roomTenant = normalizeSearchText(room.tenant);
                const matchKw = !kw || roomName.includes(kw) || roomTenant.includes(kw);
                const matchStatus = filterStatus === 'all' ||
                    (filterStatus === 'paid' && room.paymentStatus === 'Đã thanh toán') ||
                    (filterStatus === 'unpaid' && room.paymentStatus !== 'Đã thanh toán');

                if (!matchKw || !matchStatus) return;

                const isPaid = room.paymentStatus === "Đã thanh toán";

                let alertBadge = '';
                if (details.elecQty > 200) {
                    alertBadge += `<span class="bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-semibold px-2 py-0.5 rounded-md"><i class="fa-solid fa-bolt mr-1"></i>Điện cao (${details.elecQty} kWh)</span> `;
                }
                const waterNum = Math.max(0, parseNum(room.waterNew) - parseNum(room.waterOld));
                if (waterNum > 30) {
                    alertBadge += `<span class="bg-cyan-50 text-cyan-700 border border-cyan-200 text-[10px] font-semibold px-2 py-0.5 rounded-md"><i class="fa-solid fa-droplet mr-1"></i>Nước cao (${waterNum}m³)</span>`;
                }

                const card = document.createElement('div');
                card.className = `room-card ${room.status === 'Đang thuê' ? 'room-card--occupied' : 'room-card--empty'}`;
                card.innerHTML = `
                    <div class="room-card__header">
                        <div class="min-w-0">
                            <h3 class="room-card__title">${esc(room.name)}</h3>
                            <p class="room-card__meta">${room.status === 'Trống' ? 'Chưa có khách (0 người)' : `${esc(room.tenant || 'Chưa có khách')} (${Math.max(1, parseNum(room.occupants))} người) ${room.phone ? ' - ' + esc(room.phone) : ''}`}</p>
                        </div>
                        <span class="room-card__status ${room.status === 'Đang thuê' ? 'room-card__status--active' : 'room-card__status--idle'}">${esc(room.status)}</span>
                    </div>

                    ${alertBadge ? `<div class="room-card__alert-list">${alertBadge}</div>` : ''}

                    ${room.note ? `<div class="room-card__note"><i class="fa-solid fa-note-sticky mr-1"></i><strong>Ghi chú:</strong> ${esc(room.note)}</div>` : ''}
                    <div class="room-card__debt ${details.debt > 0 ? '' : 'opacity-60'}">
                        <strong>Nợ tháng trước:</strong> ${details.debt.toLocaleString('vi-VN')} đ
                    </div>

                    <div class="room-card__total-row">
                        <span>Tổng phải trả:</span>
                        <span>${details.total.toLocaleString('vi-VN')} đ</span>
                    </div>
                    
                    <div class="room-card__actions">
                        <button onclick="togglePaymentStatus('${room.docId}', event)" class="room-card__button ${isPaid ? 'room-card__button--success' : 'room-card__button--danger'}">
                            ${isPaid ? 'Đã thanh toán' : 'Chưa thanh toán'}
                        </button>
                        <button onclick="clearPreviousDebt('${room.docId}', event)" class="room-card__button room-card__button--warning ${details.debt > 0 ? '' : 'opacity-50 cursor-not-allowed'}" ${details.debt > 0 ? '' : 'disabled'}>
                            ${details.debt > 0 ? 'Xóa nợ' : 'Không nợ'}
                        </button>
                        <button onclick="openEditModal('${room.docId}')" class="room-card__button room-card__button--primary">
                            Sửa thông tin
                        </button>
                    </div>
                `;
                cardsContainer.appendChild(card);
            });

            document.getElementById('stat-total').innerText = roomsData.length;
            document.getElementById('stat-rented').innerText = rentedCount;
            document.getElementById('stat-empty').innerText = emptyCount;
            const currentRevenue = getCurrentRevenueSummary();
            document.getElementById('stat-expected-revenue').innerText = currentRevenue.expected.toLocaleString('vi-VN') + ' đ';
            document.getElementById('stat-revenue').innerText = currentRevenue.paid.toLocaleString('vi-VN') + ' đ';
            document.getElementById('stat-debt').innerText = getOutstandingDebt().toLocaleString('vi-VN') + ' đ';
            document.getElementById('stat-total-revenue').innerText = getRecordedRevenue().toLocaleString('vi-VN') + ' đ';
        };

        window.promptNextMonth = function (evt) {
            const btn = evt?.currentTarget || evt?.target;
            Swal.fire({
                title: 'Chốt sổ & Chuyển tháng mới?',
                text: 'Hệ thống sẽ tự lưu backup trước khi chuyển tháng. Sau đó sẽ chuyển tiền chưa thanh toán thành khoản nợ, cập nhật chỉ số cũ và đặt lại trạng thái thanh toán.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#4f46e5',
                confirmButtonText: 'Chốt tháng mới',
                cancelButtonText: 'Hủy',
                customClass: { popup: 'rounded-xl text-xs' }
            }).then(async (res) => {
                if (res.isConfirmed) {
                    await executeWithLock(btn, async () => {
                        showLoading();

                        try {
                            const backupName = await createPreCloseBackup();
                            if (!backupName) {
                                hideLoading();
                                return;
                            }

                            const beforeClosePayload = getBackupPayload();
                            await saveArchiveSnapshot(beforeClosePayload, `archive-${currentMonthKey()}-${Date.now()}`);

                            for (let r of roomsData) {
                                const closingMonth = currentMonthKey();

                                if (r.status === 'Đang thuê') {
                                    const currentDetails = getRoomTotalDetails({ ...r, debt: 0 });
                                    if (r.paymentStatus !== 'Đã thanh toán') {
                                        r.debt = parseNum(r.debt) + currentDetails.currentTotal;
                                        r.debtHistory = Array.isArray(r.debtHistory) ? r.debtHistory : [];
                                        r.debtHistory.push({ month: closingMonth, amount: r.debt, recordedAt: Date.now() });
                                        r.debtHistory = r.debtHistory.slice(-120);
                                    }

                                    r.elecOld = r.elecNew || r.elecOld;
                                    r.waterOld = r.waterNew || r.waterOld;
                                    r.paymentStatus = "Chưa thanh toán";
                                }

                                await set(ref(db, 'rooms/' + r.docId), r);
                            }

                            await loadAllData();
                            renderFilteredRooms();
                            hideLoading();
                            Swal.fire({ title: 'Thành công', text: 'Đã lưu backup riêng ở kho lưu trữ và chốt tháng mới thành công!', icon: 'success', customClass: { popup: 'rounded-xl text-xs' } });
                        } catch (error) {
                            hideLoading();
                            notifyError(error, 'Chốt tháng mới thất bại');
                        }
                    });
                }
            });
        };

        window.calculateTotal = function () {
            const tempRoom = {
                price: document.getElementById('room-price').value,
                occupants: document.getElementById('room-occupants').value,
                elecOld: document.getElementById('elec-old').value,
                elecNew: document.getElementById('elec-new').value,
                elecPrice: document.getElementById('elec-price').value,
                waterOld: document.getElementById('water-old').value,
                waterNew: document.getElementById('water-new').value,
                hasWaterQuota: document.getElementById('water-has-quota').checked,
                waterPriceQuota: document.getElementById('water-price-quota').value,
                waterPriceNormal: document.getElementById('water-price-normal').value,
                service: document.getElementById('room-service').value
            };
            const details = getRoomTotalDetails(tempRoom);
            document.getElementById('room-total-preview').innerText = details.total.toLocaleString('vi-VN') + ' đ';
        };

        function recordsToObject(records, idField = 'id') {
            const output = {};
            (records || []).slice(0, MAX_COLLECTION_ITEMS).forEach((record, index) => {
                const copy = { ...record };
                const id = String(copy.docId || copy[idField] || `${idField}_${Date.now()}_${index}`).replace(/[.#$\/\[\]]/g, '_').slice(0, 120);
                delete copy.docId;
                delete copy[idField];
                output[id] = copy;
            });
            return output;
        }

        function getBackupPayload() {
            return {
                version: 1,
                exportedAt: new Date().toISOString(),
                monthKey: currentMonthKey(),
                snapshotType: 'month-close',
                rooms: recordsToObject(roomsData, 'docId'),
                invoices: recordsToObject(invoicesData),
                invoiceRequests: recordsToObject(paymentRequestsData),
                issues: recordsToObject(issuesData),
                chats: chatsData
            };
        }

        async function saveArchiveSnapshot(payload, label = 'snapshot') {
            const id = `archive_${new Date().toISOString().replace(/[:.]/g, '-')}`;
            const archiveData = {
                id,
                label,
                createdAt: Date.now(),
                exportedAt: new Date().toISOString(),
                monthKey: payload?.monthKey || currentMonthKey(),
                snapshotType: payload?.snapshotType || 'month-close',
                data: payload
            };
            await set(ref(db, `${ARCHIVE_PATH}/${id}`), archiveData);
            return archiveData;
        }

        function downloadBlob(blob, filename) {
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        function parseJsonRoomList(value) {
            if (!value) return [];
            if (Array.isArray(value)) return value.filter(Boolean);
            if (typeof value === 'object') {
                const entries = Object.values(value).filter(Boolean);
                if (entries.length && entries.every(item => item && typeof item === 'object')) return entries;
            }
            return [];
        }

        function buildSnapshotCanvasFromPayload(payload, sourceLabel) {
            const roomSources = parseJsonRoomList(payload?.rooms || payload?.data?.rooms || payload?.data || payload);
            const rooms = roomSources.map(raw => {
                if (!raw || typeof raw !== 'object') return null;
                const room = { ...raw };
                const name = String(room.name || room.roomName || '');
                const tenant = String(room.tenant || room.tenants || room.customer || '');
                const phone = String(room.phone || room.phoneNumber || room.sdt || '');
                const status = String(room.status || room.paymentStatus || 'Trống');
                const price = Number(window.parseNum(room.price || room.monthlyPrice || room.giaPhong || 0));
                const elecOld = Number(window.parseNum(room.elecOld ?? room.electricOld ?? 0));
                const elecNew = Number(window.parseNum(room.elecNew ?? room.electricNew ?? 0));
                const waterOld = Number(window.parseNum(room.waterOld ?? room.waterStart ?? 0));
                const waterNew = Number(window.parseNum(room.waterNew ?? room.waterEnd ?? 0));
                const note = String(room.note || room.remark || '');
                return { name, tenant, phone, status, price, elecOld, elecNew, waterOld, waterNew, note };
            }).filter(Boolean);

            if (!rooms.length) {
                throw new Error('File JSON không chứa dữ liệu phòng hợp lệ để tạo ảnh.');
            }

            const width = 1800;
            const padding = 28;
            const rowHeight = 52;
            const height = 120 + rooms.length * rowHeight + 80;
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = width;
            canvas.height = height;

            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(0, 0, width, height);

            ctx.fillStyle = '#0f172a';
            ctx.font = 'bold 33px Arial';
            ctx.fillText('SNAPSHOT DỮ LIỆU PHÒNG', padding, 48);

            ctx.fillStyle = '#475569';
            ctx.font = '15px Arial';
            ctx.fillText(`Nguồn: ${sourceLabel}    •    Số phòng: ${rooms.length}`, padding, 74);

            const columns = [
                { label: 'Phòng', x: padding, w: 170 },
                { label: 'Khách thuê', x: padding + 180, w: 260 },
                { label: 'SĐT', x: padding + 450, w: 170 },
                { label: 'Trạng thái', x: padding + 630, w: 165 },
                { label: 'Giá phòng', x: padding + 805, w: 160 },
                { label: 'Điện', x: padding + 975, w: 170 },
                { label: 'Nước', x: padding + 1155, w: 180 },
                { label: 'Ghi chú', x: padding + 1345, w: 430 }
            ];

            let y = 110;
            ctx.fillStyle = '#e2e8f0';
            ctx.fillRect(padding, y, width - padding * 2, 38);
            ctx.font = 'bold 12px Arial';
            ctx.fillStyle = '#334155';
            columns.forEach(col => {
                ctx.fillText(col.label, col.x + 10, y + 25);
            });
            y += 38;

            rooms.forEach((room, index) => {
                const rowY = y + index * rowHeight;
                const bg = index % 2 === 0 ? '#ffffff' : '#f8fafc';
                ctx.fillStyle = bg;
                ctx.fillRect(padding, rowY, width - padding * 2, rowHeight);
                ctx.strokeStyle = '#e2e8f0';
                ctx.strokeRect(padding, rowY, width - padding * 2, rowHeight);

                const values = [
                    room.name || `Phòng ${index + 1}`,
                    room.tenant || '',
                    room.phone || '',
                    room.status || 'Trống',
                    `${room.price.toLocaleString('vi-VN')} đ`,
                    `${room.elecOld} → ${room.elecNew}`,
                    `${room.waterOld} → ${room.waterNew}`,
                    room.note ? room.note.slice(0, 80) : ''
                ];

                ctx.fillStyle = '#0f172a';
                ctx.font = '12px Arial';
                values.forEach((value, colIndex) => {
                    const col = columns[colIndex];
                    const text = String(value || '');
                    ctx.fillText(text.length > 24 ? `${text.slice(0, 24)}...` : text, col.x + 10, rowY + 29);
                });
            });

            return canvas;
        }

        function normalizeBackupRoom(raw, index) {
            if (!raw || typeof raw !== 'object') return null;
            const room = { ...raw };
            const name = String(room.name || room.roomName || `Phòng ${index + 1}`);
            const tenant = String(room.tenant || room.tenants || room.customer || '');
            const phone = String(room.phone || room.phoneNumber || room.sdt || '');
            const status = String(room.status || room.paymentStatus || 'Trống');
            const price = Number(window.parseNum(room.price || room.monthlyPrice || room.giaPhong || 0));
            const elecOld = Number(window.parseNum(room.elecOld ?? room.electricOld ?? 0));
            const elecNew = Number(window.parseNum(room.elecNew ?? room.electricNew ?? 0));
            const waterOld = Number(window.parseNum(room.waterOld ?? room.waterStart ?? 0));
            const waterNew = Number(window.parseNum(room.waterNew ?? room.waterEnd ?? 0));
            const note = String(room.note || room.remark || '');
            return {
                name,
                tenant,
                phone,
                status,
                price,
                elecOld,
                elecNew,
                waterOld,
                waterNew,
                note
            };
        }

        function openSnapshotPreview(dataUrl, title = 'Xem trước ảnh backup') {
            Swal.fire({
                title,
                html: `<div class="overflow-auto max-h-[70vh] rounded-xl border border-slate-200 bg-slate-50 p-2"><img src="${dataUrl}" alt="Snapshot" style="max-width:100%; width:100%; height:auto; border-radius:10px; display:block;" /></div>`,
                showCloseButton: true,
                showConfirmButton: true,
                confirmButtonText: 'Tải xuống',
                cancelButtonText: 'Đóng',
                showCancelButton: true,
                customClass: { popup: 'rounded-xl text-xs', confirmButton: 'bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3', cancelButton: 'bg-slate-200 text-slate-700 rounded-lg px-3' },
                buttonsStyling: false,
                didOpen: () => {
                    const confirmBtn = document.querySelector('.swal2-confirm');
                    if (confirmBtn) {
                        confirmBtn.onclick = () => {
                            const link = document.createElement('a');
                            link.href = dataUrl;
                            link.download = `snapshot-${Date.now()}.png`;
                            link.click();
                        };
                    }
                }
            });
        }

        window.renderBackupSnapshotImage = async function (file) {
            if (!file) return;
            if (!file.name.toLowerCase().endsWith('.json')) {
                return Swal.fire({ title: 'Sai định dạng', text: 'Vui lòng chọn file JSON backup.', icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
            }

            try {
                const text = await file.text();
                const payload = JSON.parse(text);
                const canvas = buildSnapshotCanvasFromPayload(payload, file.name);
                const dataUrl = canvas.toDataURL('image/png');
                openSnapshotPreview(dataUrl, `Xem trước: ${file.name}`);
                Toast.fire({ icon: 'success', title: 'Đã tạo ảnh xem trước trong web.' });
            } catch (error) {
                notifyError(error, 'Xuất ảnh từ JSON thất bại');
            }
        };

        window.renderArchiveSnapshotImage = async function (archiveId) {
            const archive = archiveSnapshotsData.find(item => item.id === archiveId);
            if (!archive || !archive.data) {
                return Swal.fire({ title: 'Không tìm thấy', text: 'Backup đã chọn không còn tồn tại.', icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
            }

            try {
                const canvas = buildSnapshotCanvasFromPayload(archive.data, archive.label || archive.id);
                const dataUrl = canvas.toDataURL('image/png');
                openSnapshotPreview(dataUrl, `Snapshot: ${archive.monthKey || archive.label || 'backup cũ'}`);
                Toast.fire({ icon: 'success', title: 'Đã hiển thị ảnh backup cũ trong web.' });
            } catch (error) {
                notifyError(error, 'Xuất ảnh backup cũ thất bại');
            }
        };

        window.createPreCloseBackup = async function () {
            if (!adminUser) {
                return Swal.fire({ title: 'Cần đăng nhập', text: authRequiredMessage(), icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
            }

            await loadAllData();
            const payload = getBackupPayload();
            const serialized = JSON.stringify(payload, null, 2);
            const fileName = `backup-truoc-chot-thang-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;

            if (new Blob([serialized]).size > MAX_BACKUP_BYTES) {
                return Swal.fire({ title: 'Dữ liệu quá lớn', text: 'Bản sao lưu vượt quá 5 MB. Hãy ưu tiên giữ lại phòng và lịch sử quan trọng nhất.', icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
            }

            downloadBlob(new Blob([serialized], { type: 'application/json' }), fileName);
            const archive = await saveArchiveSnapshot(payload, fileName);
            localStorage.setItem('lastPreCloseBackup', JSON.stringify({ fileName, createdAt: Date.now(), size: serialized.length, archiveId: archive.id }));
            if (archiveSnapshotsData.length) {
                archiveSnapshotsData = [archive, ...archiveSnapshotsData].slice(0, 50);
            } else {
                archiveSnapshotsData = [archive];
            }
            renderArchiveList();
            Toast.fire({ icon: 'success', title: 'Đã lưu backup trước khi chốt tháng.' });
            return fileName;
        };

        window.exportBackup = async function (format) {
            if (!adminUser) return Swal.fire({ title: 'Cần đăng nhập', text: authRequiredMessage(), icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
            await loadAllData();
            const payload = getBackupPayload();
            const serialized = JSON.stringify(payload);
            if (new Blob([serialized]).size > MAX_BACKUP_BYTES) {
                return Swal.fire({ title: 'Dữ liệu quá lớn', text: 'Bản sao lưu vượt quá 5 MB. Hãy xóa bớt lịch sử hoặc tin nhắn trước khi xuất.', icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
            }
            if (format === 'xlsx') {
                if (!window.XLSX) return Swal.fire({ title: 'Thiếu thư viện', text: 'SheetJS chưa tải được nên không thể xuất Excel.', icon: 'error', customClass: { popup: 'rounded-xl text-xs' } });
                const workbook = XLSX.utils.book_new();
                const history = getDebtHistoryRows();
                XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['docId', 'name', 'status', 'tenant', 'phone', 'paymentStatus', 'price', 'debt', 'deposit', 'contractNumber', 'startDate', 'endDate', 'debtHistory'], ...roomsData.map(room => [room.docId, room.name, room.status, room.tenant, room.phone, room.paymentStatus, room.price, room.debt, room.deposit, room.contractNumber, room.startDate, room.endDate, JSON.stringify(room.debtHistory || [])])]), 'Rooms');
                XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(invoicesData), 'Invoices');
                XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(paymentRequestsData), 'Requests');
                XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(issuesData), 'Issues');
                XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(history), 'DebtHistory');
                XLSX.writeFile(workbook, `nha-tro-backup-${Date.now()}.xlsx`);
            } else {
                downloadBlob(new Blob([serialized], { type: 'application/json' }), `nha-tro-backup-${Date.now()}.json`);
            }
            Toast.fire({ icon: 'success', title: 'Đã xuất bản sao lưu.' });
        };

        function renderArchiveList() {
            const list = document.getElementById('archive-history-list');
            if (!list) return;

            if (!archiveSnapshotsData.length) {
                list.innerHTML = '<div class="text-[11px] text-slate-500 border border-dashed border-slate-200 rounded-lg p-3">Chưa có backup tháng nào được lưu.</div>';
                return;
            }

            list.innerHTML = archiveSnapshotsData.map(item => {
                const monthKey = item.monthKey || item.label || 'snapshot';
                const createdAt = item.createdAt ? new Date(item.createdAt).toLocaleString('vi-VN') : 'Không rõ';
                const roomCount = item.data?.rooms ? Object.keys(item.data.rooms).length : 0;
                return `
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 border border-slate-200 rounded-lg bg-slate-50">
                        <div>
                            <div class="font-semibold text-slate-700 text-[11px]">${esc(monthKey)}</div>
                            <div class="text-[10px] text-slate-500">${esc(createdAt)} • ${roomCount} phòng</div>
                        </div>
                        <div class="flex gap-1">
                            <button onclick="renderArchiveSnapshotImage('${item.id}')" class="text-[10px] bg-amber-500 text-white px-2 py-1 rounded-md hover:bg-amber-600">Ảnh</button>
                            <button onclick="restoreArchiveSnapshot('${item.id}')" class="text-[10px] bg-indigo-600 text-white px-2 py-1 rounded-md hover:bg-indigo-700">Khôi phục</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        window.restoreArchiveSnapshot = async function (archiveId) {
            const archive = archiveSnapshotsData.find(item => item.id === archiveId);
            if (!archive || !archive.data) {
                return Swal.fire({ title: 'Không tìm thấy', text: 'Backup cũ không tồn tại.', icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
            }

            const confirm = await Swal.fire({
                title: 'Khôi phục dữ liệu cũ?',
                text: `Bạn đang khôi phục snapshot từ ${archive.monthKey || archive.label || 'backup cũ'} vào dữ liệu hiện tại. Hành động này sẽ ghi đè dữ liệu đang hoạt động nhưng chỉ khi bạn xác nhận.`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Khôi phục',
                cancelButtonText: 'Hủy',
                confirmButtonColor: '#4f46e5',
                customClass: { popup: 'rounded-xl text-xs' }
            });

            if (!confirm.isConfirmed) return;

            try {
                const payload = archive.data;
                const rooms = asCollection(payload.rooms);
                const cleanRooms = {};
                Object.entries(rooms).forEach(([id, room]) => {
                    const clean = sanitizeImportedRoom(room, id);
                    const cleanId = clean.docId;
                    delete clean.docId;
                    cleanRooms[cleanId] = clean;
                });
                const cleanPayload = {
                    rooms: cleanRooms,
                    invoices: asCollection(payload.invoices),
                    invoiceRequests: asCollection(payload.invoiceRequests),
                    issues: asCollection(payload.issues),
                    chats: sanitizeImportedChats(payload.chats)
                };

                showLoading();
                for (const [collection, records] of Object.entries(cleanPayload)) {
                    await set(ref(db, collection), records);
                }
                await loadAllData();
                renderFilteredRooms();
                hideLoading();
                Toast.fire({ icon: 'success', title: 'Đã khôi phục dữ liệu từ backup cũ.' });
            } catch (error) {
                hideLoading();
                notifyError(error, 'Khôi phục backup cũ thất bại');
            }
        };

        function asCollection(value) {
            if (Array.isArray(value)) return recordsToObject(value);
            if (!value || typeof value !== 'object') return {};
            return Object.fromEntries(Object.entries(value).slice(0, MAX_COLLECTION_ITEMS).filter(([, item]) => item && typeof item === 'object'));
        }

        function sanitizeImportedRoom(raw, id) {
            const room = { ...raw };
            room.name = boundedText(room.name, 100);
            room.status = room.status === 'Đang thuê' ? 'Đang thuê' : 'Trống';
            room.tenant = boundedText(room.tenant, 150);
            room.phone = boundedText(room.phone, 30);
            room.note = boundedText(room.note);
            room.contractNumber = boundedText(room.contractNumber, 100);
            room.deposit = Math.max(0, parseNum(room.deposit));
            room.debt = Math.max(0, parseNum(room.debt));
            room.debtHistory = Array.isArray(room.debtHistory) ? room.debtHistory.slice(-120) : [];
            room.docId = String(id).replace(/[.#$\/\[\]]/g, '_').slice(0, 120);
            assertRecordSize(room);
            return room;
        }

        function parseBackupWorkbook(data) {
            const workbook = XLSX.read(data, { type: 'array' });
            const read = name => workbook.Sheets[name] ? XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: '' }) : [];
            const rooms = {};
            read('Rooms').forEach((row, index) => {
                if (row.debtHistory && typeof row.debtHistory === 'string') {
                    try { row.debtHistory = JSON.parse(row.debtHistory); } catch { row.debtHistory = []; }
                }
                const id = row.docId || `room_import_${index}`;
                rooms[id] = sanitizeImportedRoom(row, id);
                delete rooms[id].docId;
            });
            return { rooms, invoices: asCollection(read('Invoices')), invoiceRequests: asCollection(read('Requests')), issues: asCollection(read('Issues')) };
        }

        function sanitizeImportedChats(value) {
            if (!value || typeof value !== 'object') return {};
            const output = {};
            Object.entries(value).slice(0, MAX_ROOMS).forEach(([roomId, messages]) => {
                if (!messages || typeof messages !== 'object') return;
                output[String(roomId).replace(/[.#$\/\[\]]/g, '_').slice(0, 120)] = {};
                Object.entries(messages).slice(0, MAX_COLLECTION_ITEMS).forEach(([messageId, message]) => {
                    if (!message || typeof message !== 'object') return;
                    const clean = {
                        sender: message.sender === 'admin' ? 'admin' : 'tenant',
                        senderName: boundedText(message.senderName, 100),
                        text: boundedText(message.text),
                        image: /^data:image\/[a-z0-9.+-]+;base64,/i.test(String(message.image || '')) ? message.image : '',
                        timestamp: Number(message.timestamp) || Date.now()
                    };
                    assertRecordSize(clean);
                    output[String(roomId).replace(/[.#$\/\[\]]/g, '_').slice(0, 120)][String(messageId).replace(/[.#$\/\[\]]/g, '_').slice(0, 120)] = clean;
                });
            });
            return output;
        }

        window.importBackupFile = async function (file) {
            if (!file) return;
            if (!adminUser) {
                document.getElementById('backup-file-input').value = '';
                return Swal.fire({ title: 'Cần đăng nhập', text: authRequiredMessage(), icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
            }
            if (file.size > MAX_BACKUP_BYTES) {
                document.getElementById('backup-file-input').value = '';
                return Swal.fire({ title: 'Tệp quá lớn', text: 'Chỉ chấp nhận tệp sao lưu tối đa 5 MB.', icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
            }
            try {
                const data = await file.arrayBuffer();
                const isJson = file.name.toLowerCase().endsWith('.json');
                const payload = isJson ? JSON.parse(new TextDecoder().decode(data)) : parseBackupWorkbook(data);
                const rooms = asCollection(payload.rooms);
                if (Object.keys(rooms).length > MAX_ROOMS) throw new Error(`Bản sao lưu có hơn ${MAX_ROOMS} phòng.`);
                const cleanRooms = {};
                Object.entries(rooms).forEach(([id, room]) => {
                    const clean = sanitizeImportedRoom(room, id);
                    const cleanId = clean.docId;
                    delete clean.docId;
                    cleanRooms[cleanId] = clean;
                });
                const cleanPayload = {
                    rooms: cleanRooms,
                    invoices: asCollection(payload.invoices),
                    invoiceRequests: asCollection(payload.invoiceRequests),
                    issues: asCollection(payload.issues),
                    chats: sanitizeImportedChats(payload.chats)
                };
                if (new Blob([JSON.stringify(cleanPayload)]).size > MAX_BACKUP_BYTES) throw new Error('Dữ liệu sau khi kiểm tra vẫn vượt quá 5 MB.');
                const result = await Swal.fire({
                    title: 'Khôi phục bản sao lưu?',
                    text: 'Các nhóm dữ liệu có trong tệp sẽ được ghi đè lên CSDL hiện tại.',
                    icon: 'warning', showCancelButton: true, confirmButtonText: 'Khôi phục', cancelButtonText: 'Hủy', confirmButtonColor: '#e11d48',
                    customClass: { popup: 'rounded-xl text-xs' }
                });
                if (!result.isConfirmed) return;
                showLoading();
                for (const [collection, records] of Object.entries(cleanPayload)) await set(ref(db, collection), records);
                await loadAllData();
                renderFilteredRooms();
                hideLoading();
                Toast.fire({ icon: 'success', title: 'Đã khôi phục bản sao lưu.' });
            } catch (error) {
                hideLoading();
                notifyError(error, 'Nhập sao lưu thất bại');
            } finally {
                document.getElementById('backup-file-input').value = '';
            }
        };

        window.openAddRoomModal = function () {
            if (roomsData.length >= MAX_ROOMS) {
                return Swal.fire({ title: 'Thông báo', text: 'Hệ thống đã đạt giới hạn tối đa 12 phòng!', icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
            }
            currentEditingDocId = null;
            document.getElementById('modal-title').innerText = 'Thêm phòng mới';
            document.getElementById('room-name').value = `Phòng ${roomsData.length + 1}`;
            document.getElementById('room-status').value = 'Trống';
            document.getElementById('room-tenant').value = '';
            document.getElementById('room-occupants').value = '0';
            document.getElementById('room-phone').value = '';
            document.getElementById('room-is-paid').value = 'Chưa thanh toán';
            document.getElementById('room-previous-debt').value = '0';
            document.getElementById('room-price').value = '2,000,000';
            document.getElementById('elec-price').value = '4,000';
            document.getElementById('elec-old').value = '0';
            document.getElementById('elec-new').value = '0';
            document.getElementById('water-old').value = '0';
            document.getElementById('water-new').value = '0';
            document.getElementById('water-has-quota').checked = true;
            document.getElementById('water-price-quota').value = '14,000';
            document.getElementById('water-price-normal').value = '20,000';
            document.getElementById('room-service').value = '100,000';
            document.getElementById('room-note').value = '';
            document.getElementById('btnDeleteRoom').classList.add('hidden');
            handleRoomStatusChange();
            calculateTotal();
            document.getElementById('roomModal').classList.remove('hidden');
        };

        window.openEditModal = function (docId) {
            const room = roomsData.find(r => r.docId === docId);
            if (!room) return;
            currentEditingDocId = docId;
            document.getElementById('modal-title').innerText = `Chỉnh sửa: ${room.name}`;
            document.getElementById('room-name').value = room.name || '';
            document.getElementById('room-status').value = room.status || 'Trống';
            document.getElementById('room-tenant').value = room.tenant || '';
            document.getElementById('room-occupants').value = room.occupants || 0;
            document.getElementById('room-phone').value = room.phone || '';
            document.getElementById('room-is-paid').value = room.paymentStatus || 'Chưa thanh toán';
            document.getElementById('room-previous-debt').value = parseNum(room.previousMonthDebt ?? room.debt ?? 0).toLocaleString('en-US');
            document.getElementById('room-price').value = parseNum(room.price).toLocaleString('en-US');
            document.getElementById('elec-price').value = parseNum(room.elecPrice || 4000).toLocaleString('en-US');
            document.getElementById('elec-old').value = parseNum(room.elecOld).toLocaleString('en-US');
            document.getElementById('elec-new').value = parseNum(room.elecNew).toLocaleString('en-US');
            document.getElementById('water-old').value = parseNum(room.waterOld).toLocaleString('en-US');
            document.getElementById('water-new').value = parseNum(room.waterNew).toLocaleString('en-US');
            document.getElementById('water-has-quota').checked = room.hasWaterQuota !== false;
            document.getElementById('water-price-quota').value = parseNum(room.waterPriceQuota || 14000).toLocaleString('en-US');
            document.getElementById('water-price-normal').value = parseNum(room.waterPriceNormal || 20000).toLocaleString('en-US');
            document.getElementById('room-service').value = parseNum(room.service).toLocaleString('en-US');
            document.getElementById('room-note').value = room.note || '';
            document.getElementById('btnDeleteRoom').classList.remove('hidden');
            handleRoomStatusChange();
            calculateTotal();
            document.getElementById('roomModal').classList.remove('hidden');
        };

        window.handleRoomStatusChange = function () {
            const status = document.getElementById('room-status').value;
            const isRented = status === 'Đang thuê';
            const tenantInput = document.getElementById('room-tenant');
            const occupantsInput = document.getElementById('room-occupants');

            if (!isRented) {
                tenantInput.value = '';
                occupantsInput.value = '0';
            } else {
                if (Number(occupantsInput.value) <= 0) occupantsInput.value = '1';
            }
            calculateTotal();
        };

        window.closeModal = function () {
            document.getElementById('roomModal').classList.add('hidden');
        };

        window.saveRoom = async function (e) {
            e.preventDefault();
            const btn = e.submitter;

            const name = boundedText(document.getElementById('room-name').value, 100);
            const status = document.getElementById('room-status').value;
            const tenant = boundedText(document.getElementById('room-tenant').value, 150);
            const occupants = parseNum(document.getElementById('room-occupants').value);
            const price = parseNum(document.getElementById('room-price').value);
            const elecPrice = parseNum(document.getElementById('elec-price').value);
            const elecOld = parseNum(document.getElementById('elec-old').value);
            const elecNew = parseNum(document.getElementById('elec-new').value);
            const waterOld = parseNum(document.getElementById('water-old').value);
            const waterNew = parseNum(document.getElementById('water-new').value);
            const waterPriceQuota = parseNum(document.getElementById('water-price-quota').value);
            const waterPriceNormal = parseNum(document.getElementById('water-price-normal').value);
            const service = parseNum(document.getElementById('room-service').value);

            if (!name) return Swal.fire({ title: 'Thiếu thông tin', text: 'Vui lòng nhập tên phòng.', icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
            if (status === 'Đang thuê') {
                if (!tenant) return Swal.fire({ title: 'Thiếu thông tin', text: 'Vui lòng nhập tên khách thuê khi phòng ở trạng thái "Đang thuê".', icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
                if (occupants <= 0) return Swal.fire({ title: 'Thiếu thông tin', text: 'Số người phải lớn hơn 0 khi phòng đang thuê.', icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
            }
            if (roomsData.some(room => room.docId !== currentEditingDocId && room.name.toLowerCase() === name.toLowerCase())) {
                return Swal.fire({ title: 'Trùng tên phòng', text: 'Tên phòng đã tồn tại. Vui lòng chọn tên khác.', icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
            }
            if ([price, elecPrice, elecOld, elecNew, waterOld, waterNew, waterPriceQuota, waterPriceNormal, service].some(value => value < 0)) {
                return Swal.fire({ title: 'Dữ liệu không hợp lệ', text: 'Các chỉ số và đơn giá không được là số âm.', icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
            }
            if (elecNew < elecOld) {
                return Swal.fire({ title: 'Chỉ số điện không hợp lệ', text: 'Số mới phải lớn hơn hoặc bằng số cũ.', icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
            }
            if (waterNew < waterOld) {
                return Swal.fire({ title: 'Chỉ số nước không hợp lệ', text: 'Số mới phải lớn hơn hoặc bằng số cũ.', icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });
            }
            const existingRoom = roomsData.find(room => room.docId === currentEditingDocId);
            const previousMonthDebt = status === 'Đang thuê'
                ? Math.max(0, parseNum(document.getElementById('room-previous-debt').value || existingRoom?.previousMonthDebt || existingRoom?.debt || 0))
                : 0;

            const roomData = {
                name: name,
                status: status,
                tenant: status === 'Đang thuê' ? tenant : '',
                occupants: status === 'Đang thuê' ? occupants : 0,
                phone: status === 'Đang thuê' ? boundedText(document.getElementById('room-phone').value, 30) : '',
                paymentStatus: document.getElementById('room-is-paid').value,
                previousMonthDebt,
                debt: previousMonthDebt,
                price,
                elecPrice,
                elecOld,
                elecNew,
                waterOld,
                waterNew,
                hasWaterQuota: document.getElementById('water-has-quota').checked,
                waterPriceQuota,
                waterPriceNormal,
                service,
                note: boundedText(document.getElementById('room-note').value),
                debtHistory: Array.isArray(existingRoom?.debtHistory)
                    ? existingRoom.debtHistory.slice(-120) : []
            };
            assertRecordSize(roomData);

            await executeWithLock(btn, async () => {
                showLoading();
                const docId = currentEditingDocId || ('room_' + Date.now());
                await set(ref(db, 'rooms/' + docId), roomData);
                await loadAllData();
                renderFilteredRooms();
                closeModal();
                hideLoading();
                Toast.fire({ icon: 'success', title: 'Đã lưu thông tin phòng thành công!' });
            });
        };

        window.deleteCurrentRoom = async function (evt) {
            const btn = evt?.currentTarget || evt?.target;
            if (!currentEditingDocId) return;

            const res = await Swal.fire({
                title: 'Xóa phòng này?',
                text: 'Hành động này không thể hoàn tác!',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#e11d48',
                confirmButtonText: 'Xóa',
                cancelButtonText: 'Hủy',
                customClass: { popup: 'rounded-xl text-xs' }
            });

            if (res.isConfirmed) {
                await executeWithLock(btn, async () => {
                    showLoading();
                    await remove(ref(db, 'rooms/' + currentEditingDocId));
                    await loadAllData();
                    renderFilteredRooms();
                    closeModal();
                    hideLoading();
                    Toast.fire({ icon: 'success', title: 'Đã xóa phòng thành công!' });
                });
            }
        };

        window.togglePaymentStatus = async function (docId, evt) {
            const btn = evt?.currentTarget || evt?.target;
            const room = roomsData.find(r => r.docId === docId);
            if (!room) return;

            await executeWithLock(btn, async () => {
                showLoading();
                const isPaid = room.paymentStatus === "Đã thanh toán";
                room.paymentStatus = isPaid ? "Chưa thanh toán" : "Đã thanh toán";
                if (!isPaid) {
                    room.previousMonthDebt = 0;
                    room.debt = 0;
                }
                await set(ref(db, 'rooms/' + room.docId), room);
                await loadAllData();
                renderFilteredRooms();
                if (activeTenantRoom && activeTenantRoom.docId === room.docId) {
                    activeTenantRoom = room;
                    displayTenantInfo(room);
                }
                hideLoading();
                Toast.fire({ icon: 'success', title: 'Đã cập nhật trạng thái thanh toán!' });
            });
        };

        window.clearPreviousDebt = async function (docId, evt) {
            const btn = evt?.currentTarget || evt?.target;
            const room = roomsData.find(r => r.docId === docId);
            if (!room) return;

            const debt = getRoomCommittedDebt(room);
            if (debt <= 0) {
                return Swal.fire({
                    title: 'Không có nợ kỳ trước',
                    text: `Phòng ${room.name} hiện không còn khoản nợ nào để xóa.`,
                    icon: 'info',
                    customClass: { popup: 'rounded-xl text-xs' }
                });
            }

            const res = await Swal.fire({
                title: 'Xóa nợ kỳ trước?',
                text: `Bạn chắc chắn muốn xóa khoản nợ ${debt.toLocaleString('vi-VN')} đ của phòng ${room.name}?`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#f59e0b',
                confirmButtonText: 'Xóa nợ',
                cancelButtonText: 'Hủy',
                customClass: { popup: 'rounded-xl text-xs' }
            });

            if (!res.isConfirmed) return;

            await executeWithLock(btn, async () => {
                showLoading();
                room.debt = 0;
                room.debtHistory = Array.isArray(room.debtHistory) ? room.debtHistory : [];
                room.debtHistory.push({
                    month: currentMonthKey(),
                    amount: 0,
                    type: 'clear-debt',
                    note: 'Xóa nợ kỳ trước',
                    recordedAt: Date.now()
                });
                room.debtHistory = room.debtHistory.slice(-120);

                await set(ref(db, 'rooms/' + room.docId), room);
                await loadAllData();
                renderFilteredRooms();
                if (activeTenantRoom && activeTenantRoom.docId === room.docId) {
                    activeTenantRoom = room;
                    displayTenantInfo(room);
                }
                hideLoading();
                Toast.fire({ icon: 'success', title: 'Đã xóa nợ kỳ trước!' });
            });
        };

        window.openTenantIssueModal = function () {
            if (!activeTenantRoom) return;
            document.getElementById('issue-text').value = '';
            document.getElementById('issue-image').value = '';
            document.getElementById('issue-image-name').innerText = '';
            document.getElementById('issueModal').classList.remove('hidden');
        };

        window.closeIssueModal = function () {
            document.getElementById('issueModal').classList.add('hidden');
        };

        window.submitIssue = async function (evt) {
            const btn = evt?.currentTarget || evt?.target;
            const content = boundedText(document.getElementById('issue-text').value);
            const imageInput = document.getElementById('issue-image');
            if (!content || !activeTenantRoom) return Swal.fire({ title: 'Thiếu thông tin', text: 'Vui lòng mô tả chi tiết sự cố.', icon: 'warning', customClass: { popup: 'rounded-xl text-xs' } });

            await executeWithLock(btn, async () => {
                showLoading();
                const image = await readImageAsDataUrl(imageInput.files[0]);
                const issueId = 'issue_' + Date.now();
                const issueData = {
                    id: issueId,
                    roomDocId: activeTenantRoom.docId,
                    roomName: activeTenantRoom.name,
                    tenantName: activeTenantRoom.tenant || 'Khách',
                    content: content,
                    image,
                    date: new Date().toLocaleString('vi-VN'),
                    resolved: false
                };
                assertRecordSize(issueData);
                await set(ref(db, 'issues/' + issueId), issueData);
                await loadAllData();
                imageInput.value = '';
                closeIssueModal();
                hideLoading();
                Toast.fire({ icon: 'success', title: 'Đã gửi báo cố thành công!' });
            });
        };

        loadAllData();
    