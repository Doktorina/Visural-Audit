<p align="center">
  <img src="victory-check-mobile/icons/icon-192.png" alt="Visural Audit" width="72" height="72" />
</p>

<h1 align="center">Visural Audit</h1>

<p align="center">
  <strong>Фиксация нарушений охраны труда на стройплощадке</strong><br/>
  мобильное приложение + админ-панель + API
</p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-API-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" />
  <img alt="PWA" src="https://img.shields.io/badge/Mobile-PWA-0A66C2?style=for-the-badge" />
  <img alt="Admin" src="https://img.shields.io/badge/Admin-Web%20panel-512BD4?style=for-the-badge" />
  <img alt="Demo" src="https://img.shields.io/badge/Data-Demo-2ea44f?style=for-the-badge" />
</p>

---

Система для учёта нарушений ОТ на объектах: инспектор на площадке делает фото, оформляет акт в телефоне, подрядчик получает уведомление и отвечает отчётом об устранении. Админ видит всю картину в веб-панели — объекты, организации, люди, статусы, аналитика.

В репозитории — демо с тестовыми данными. Боевые учётки, почта, пароли и скрипты выкладки не включены.

## Как это работает на объекте

1. **Нашли нарушение** — инспектор открывает мобильное приложение и жмёт «+».
2. **Мастер из 8 шагов** — объект → организация → категория → **фото** → описание → нормы → критичность → подтверждение.
3. **Создаётся акт** — нарушение уходит в журнал, подрядчику уходит уведомление (push / email / Telegram — по настройкам).
4. **Подрядчик отвечает** — в карточке нарушения пишет отчёт об устранении и прикладывает фото «как стало».
5. **Закрытие** — статус меняют на «устранено» (инспектор или админ), история и комментарии остаются в карточке.

<p align="center">
  <img src="docs/screenshots/12-mobile-create.png" alt="Создание акта" width="220" />
  &nbsp;
  <img src="docs/screenshots/06-mobile-photo.png" alt="Фото на объекте" width="220" />
  &nbsp;
  <img src="docs/screenshots/07-mobile-confirm.png" alt="Подтверждение и отправка" width="220" />
</p>
<p align="center">
  <img src="docs/screenshots/08-mobile-detail.png" alt="Карточка с фиксацией" width="220" />
  &nbsp;
  <img src="docs/screenshots/09-mobile-actions.png" alt="Действия по акту" width="220" />
  &nbsp;
  <img src="docs/screenshots/10-mobile-report.png" alt="Отчёт об устранении" width="220" />
</p>

## Кто что может

### Администратор (`admin@demo.local`)

Веб-панель + полный доступ в мобильном:

- объекты, организации, категории, пользователи и роли;
- журнал всех нарушений, смена статусов, удаление;
- аналитика по категориям / подрядчикам / срокам;
- подтверждение новых регистраций;
- рассылка актов и уведомлений.

| Вход в админку | Аналитика |
|:--------------:|:---------:|
| ![Вход](docs/screenshots/01-admin-login.png) | ![Аналитика](docs/screenshots/02-admin-dashboard.png) |

| Журнал нарушений | Пользователи и роли |
|:----------------:|:-------------------:|
| ![Нарушения](docs/screenshots/03-admin-violations.png) | ![Пользователи](docs/screenshots/13-admin-users.png) |

### Инспектор / аудитор (`inspector@demo.local`)

Обычный «человек на площадке» — работает в основном с телефона:

- лента нарушений по своим объектам;
- создание акта с фото (камера или галерея, до 10 снимков);
- комментарии, смена статуса, отправка акта подрядчику;
- просмотр аналитики по доступным объектам.

<p align="center">
  <img src="docs/screenshots/05-mobile-list.png" alt="Лента нарушений" width="220" />
  &nbsp;
  <img src="docs/screenshots/11-mobile-analytics.png" alt="Аналитика в телефоне" width="220" />
</p>

### Подрядчик (`contractor@demo.local`)

Исполнитель, которому прилетает предписание:

- видит нарушения своей организации;
- пишет комментарии и **отчёт об устранении** с фото;
- не управляет справочниками и чужими объектами.

Пароль для всех демо-учёток: `123`.

## Стек

- **Node.js** HTTP API
- Хранение: JSON (`victory-check-api/data/db.json`; опционально PostgreSQL)
- Админка и мобильный клиент — статический web, раздаётся API

## Запуск

Нужен [Node.js](https://nodejs.org/).

```bat
start-demo.bat
```

| | |
|:--|:--|
| Админка | http://localhost:4000/admin/ |
| Мобильное | http://localhost:4000/mobile/ |
| Логин | `admin@demo.local` |
| Пароль | `123` |

Окно запуска не закрывайте — пока оно открыто, сервис работает.

## Структура

```text
victory-check-api/     — API и раздача /admin /mobile
victory-check-admin/   — веб-панель
victory-check-mobile/  — мобильный PWA-клиент
docs/screenshots/      — скриншоты
```

## Демо-данные

- Объекты: ЖК «Демо Парк», Офисный центр «Север»
- Подрядчики: ООО «Подряд Демо», ООО «Монтаж Плюс»
- Несколько нарушений с разными статусами (открыто / в работе / устранено)
- Пользователи: `admin@demo.local`, `inspector@demo.local`, `contractor@demo.local` (пароль `123`)
