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

Система для учёта нарушений ОТ на объектах строительства: фотофиксация с телефона, предписания, сроки устранения, уведомления и аналитика по подрядчикам и объектам.

В репозитории — демо с тестовыми данными. Боевые учётки, почта, пароли и скрипты выкладки не включены.

## Основные возможности

- **Мобильное приложение (PWA)** — фиксация нарушений на объекте, фото, категории, сроки
- **Админ-панель** — аналитика, журнал нарушений, объекты, организации, пользователи
- **Роли** — администратор, аудитор/проверяющий, подрядчик
- **Уведомления** — о новых нарушениях и сроках устранения
- **Документы** — предписания и выгрузки для работы с подрядчиками
- **API** — общий backend для мобильного клиента и админки

## Скриншоты

| Вход (админка) | Аналитика |
|:--------------:|:---------:|
| ![Вход](docs/screenshots/01-admin-login.png) | ![Аналитика](docs/screenshots/02-admin-dashboard.png) |

| Журнал нарушений | Мобильное |
|:----------------:|:---------:|
| ![Нарушения](docs/screenshots/03-admin-violations.png) | ![Мобильное](docs/screenshots/04-mobile.png) |

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
- Пользователи: `admin@demo.local`, `inspector@demo.local` (пароль `123`)
