# Business Requirements Document
## Personal Finance Insights Dashboard (working title)

| Item | Detail |
|---|---|
| Document type | Business Requirements Document (BRD) |
| Version | 1.2 |
| Date | 28 September 2026 |
| Owner / sole user | The product owner (single personal user) |
| Audience | The build agent / developer implementing the product |
| Status | Approved for build |

**Change log**
| Version | Change |
|---|---|
| 1.0 | First version. |
| 1.1 | (a) "Family support" broadened to a general **Family** subcategory covering any money spent on or sent to family. "Gifts & treats for others" renamed **Friends & others**. (b) **History import from the old app added back** as FR-14: a guided, one-time migration of about 3 years of data, including categories and accounts that no longer exist in the old app. Related sections updated: 2, 4, 6, 7 (FR-7), 8, 10, 12, 13, 14.
| 1.2 | **FR-14 is a one-time scripted import, not an in-app feature** (owner decision). The builder imports the owner's export with a script and the owner reviews the mappings once. The upload and mapping screens, the first-launch "Start fresh / Import my history" choice and Settings → Import are dropped. FR-14.1 and FR-14.3 still apply to the script. See tech decision TD-12.

> **Note to the build agent:** This document describes *what* the product must do and *how we will know it works*. It deliberately contains no technology choices. You decide the stack, architecture, storage and hosting. Where this document gives a formula, the formula is a business rule, not an implementation hint. Where something is unclear, check Section 14 (Open Questions) first, then choose the simplest reasonable option and record the decision.

---

## 1. Background

The owner has tracked every rupee for about three years in a mobile money-manager app. The app is good at *recording* (date, account, category, subcategory, note, amount, income/expense/transfer) but gives **no insight**. The owner knows roughly where money goes but cannot answer questions like:

- How much of my salary is already spoken for before I spend anything by choice?
- Am I spending faster than usual this month?
- What do small daily expenses (rickshaws, snacks, ironing) cost me over a year?
- Am I keeping to my 50/30/20 plan?
- What did that trip really cost per day?

The owner wants a new **personal web dashboard**, usable on phone and laptop, where transactions are entered directly and the product turns them into useful insights. If data entry is fast enough, the new product **replaces** the old app entirely.

## 2. Objectives

1. **Replace the old app for daily logging.** Entering a transaction must be as fast as, or faster than, the current app.
2. **Turn records into insight.** Every screen should answer a question, not only list data.
3. **Work fully without AI.** All core insights are calculated by the product itself.
4. **Offer optional AI.** The owner can plug in their own AI provider key (OpenAI, Anthropic or Google Gemini, plus custom) to unlock extra features.
5. **Support a budgeting rule.** The owner can apply 50/30/20 or any custom split and track adherence.
6. **Simplify categories.** Move from about 15 categories and 60 subcategories to a lean, editable set of 8.
7. **Bring history along.** Optionally import about 3 years of history from the old app on day one, so every insight works from the start.

## 3. Success Measures

| # | Measure | Target |
|---|---|---|
| S1 | Time to log a typical expense on a phone | Under 10 seconds from opening the product |
| S2 | Owner stops using the old app | Within 1 month of launch |
| S3 | Insights available without AI | 100% of the insights in Section 9 |
| S4 | Accuracy of all figures | Exact to the paisa and consistent across every screen |
| S5 | Owner opens the dashboard | Daily, on their own initiative |

## 4. Scope

### 4.1 In scope
- Single-user personal dashboard, accessible from phone and laptop browsers, installable to the phone home screen
- Accounts (bank, credit card, wallet, savings and investment destinations)
- Fast manual transaction entry (expense, income, transfer)
- Simplified, editable category system with default budget buckets
- Tags for events such as trips
- Recurring commitments and upcoming bills
- Budget rules (50/30/20 or custom)
- Native insights and dashboard (no AI needed)
- Optional AI integration using the owner's own API key
- Export and backup of the owner's data
- One-time import of history from the old money-manager app (optional to use; see FR-14)

### 4.2 Out of scope (for this version)
- Ongoing sync with the old app, and importing from any other app or from bank statements. FR-14 covers only the old app's export.
- Automatic bank or card syncing
- Multiple users, shared or family accounts
- Currencies other than INR
- Live market valuation of investments (only amounts moved in and out are tracked)
- Paying bills or moving real money
- Tax filing or tax advice

## 5. User and Usage Context

- **One user**, based in India. Currency is INR, time zone is IST.
- **Heavy daily logger.** Often 3 to 10 entries a day, many of them small (₹10 to ₹200).
- **Multiple accounts.** Typically one main bank account (used for most UPI spends), one or two cashback credit cards, a cash wallet, and savings or investment destinations (Fixed Deposit, Mutual Fund, Equity, Bond, Emergency Fund).
- **Salary** arrives once a month. There is occasional other income: cashback, interest, side income, bonus.
- **Large fixed monthly commitments.** Rent, furniture rental, house help, money sent to family, gym, term insurance, subscriptions, utilities.
- **Travel.** Takes trips and wants to see the cost of each one.
- **Devices.** Logs mostly on the phone. Reviews on phone and sometimes laptop.

## 6. Glossary

| Term | Meaning |
|---|---|
| **Transaction** | A single money event: Expense, Income, or Transfer. |
| **Account** | Where money sits or is owed: Bank, Credit Card, Wallet/Cash, Savings/Investment. |
| **Category / Subcategory** | Two-level classification of expenses and income (see Section 10). |
| **Bucket** | The budget-rule group a subcategory belongs to: Needs, Wants or Savings by default. |
| **Tag** | A free label grouping transactions across categories, such as "Goa Trip". |
| **Transfer** | Money moving between the owner's own accounts. Never counted as spending or income. |
| **Recurring commitment** | A known repeating payment such as rent, gym or a subscription. |
| **Committed money** | The total of recurring commitments due in the current month. |
| **Free money** | Income for the month minus committed money. |
| **Budget month** | The period used for monthly figures. Defaults to the calendar month (see FR-12). |
| **Import batch** | All transactions brought in by a single import. They can be undone together. |
| **Needs review** | A holding place for imported transactions whose old category has not yet been mapped to a new one. |
| **Balance adjustment** | A one-off correction so an account's balance matches reality. Excluded from all insights. |

---

## 7. Functional Requirements

Priority uses MoSCoW: **M** = Must, **S** = Should, **C** = Could.
Each requirement lists acceptance criteria (AC) that must pass.

### FR-1 Accounts (M)

The owner can create, edit, archive and view accounts.

- Account types: **Bank**, **Credit Card**, **Wallet/Cash**, **Savings/Investment**.
- Each account has a name, type, opening balance and opening date.
- Credit cards also have a statement day and a payment due day.
- Each account shows its current balance. For credit cards, it shows the outstanding amount.
- A summary shows total money available (bank + wallet), total card dues, and total in savings/investment accounts.

**AC**
1. Creating "Main Bank" (Bank) with an opening balance of ₹10,000, then logging a ₹120 expense from it, shows a balance of ₹9,880.
2. Archived accounts are hidden from entry screens but their history stays in all reports.
3. A credit card shows outstanding = card expenses − card payments received − refunds or cashback credited to the card.

### FR-2 Fast transaction entry (M, highest priority)

Speed of entry is the single biggest factor in whether the owner abandons the old app.

- An **Add** action is always one tap away on every screen.
- The flow starts **amount first**, with a numeric keypad.
- Defaults: date = today, time = now, account = the most used account.
- **Quick picks:** the most frequent recent combinations are shown as one-tap suggestions. For example: "Rickshaw ₹120 · Main Bank", "Ironing ₹50 · Main Bank", "Lunch ₹150 · Main Bank". Choosing one pre-fills everything and the owner can adjust the amount.
- The product **remembers** the category last used with a given note or subcategory.
- **Multi-line entry:** several items can be logged in one go (for example, a grocery run split into Groceries, Healthy food and Toiletries on the same card) without restarting the flow.
- **Duplicate:** any past transaction can be copied as a new one.
- Optional fields: note, description, tag.
- Any transaction can be edited and deleted, with a confirmation before deleting.
- Future-dated transactions are allowed and are treated as **planned** (see BR-7).

**AC**
1. A common expense (for example, a rickshaw ride on the default account) can be saved in **3 taps or fewer after typing the amount**, and in under 10 seconds overall on a phone.
2. After three entries of "Rickshaw" on the same account, it appears as a quick pick.
3. Three lines entered in one multi-line entry save as three separate transactions sharing the same date and time.
4. Editing a transaction's amount updates every balance, total and insight that depends on it.

### FR-3 Transfers and credit cards (M)

- A **Transfer** moves money from one account to another. It is never counted as expense or income.
- **Paying a credit card bill** is a transfer from a bank account to the card. It reduces the bank balance and the card outstanding, and does **not** increase spending.
- A transfer **into a Savings/Investment account** (FD, Mutual Fund, Equity, Bond, Emergency Fund) counts as **saving** for the savings rate and the budget rule.
- A transfer **out of** a Savings/Investment account back to a bank account counts as a **withdrawal from savings** and is shown as such.

**AC**
1. Paying ₹12,345.67 from Main Bank to the Cashback card leaves total monthly spending unchanged. Main Bank's balance drops by ₹12,345.67 and the card outstanding drops by the same amount.
2. Transferring ₹10,000 from Main Bank to "Mutual Fund" raises "Saved this month" by ₹10,000 and does not appear in expenses.

### FR-4 Categories (M)

- The product ships with the default taxonomy in **Section 10**.
- The owner can add, rename, merge, hide and reorder categories and subcategories.
- Each subcategory has a **default bucket** (Needs, Wants or Savings), which the owner can change.
- **Merging** subcategory A into B moves all of A's past transactions to B.
- Hidden categories stay visible in historical reports.
- **Lost Track** is a system subcategory for money the owner cannot account for. It can be renamed but not deleted.

**AC**
1. A new install shows exactly the 8 expense categories and 4 income categories in Section 10.
2. Merging "Junk & treats" into "Eating out" moves all past Junk transactions, and every report reflects the change.
3. Changing the bucket of "Gym & training" from Wants to Needs changes budget-rule figures for all months.

### FR-5 Tags / events (M)

- Transactions can carry one or more tags, such as "Goa Trip" or "Diwali 2026".
- A tag can optionally have a start and end date. The product can then **suggest** tagging transactions in that date range, but never tags them automatically.
- Each tag has its own report (see INS-13).

**AC**
1. Tagging 10 transactions "Hill Station Trip" produces a trip report that totals exactly those 10.

### FR-6 Recurring commitments and upcoming bills (M)

- The owner can define recurring commitments with a name, expected amount, account, category, frequency (monthly, weekly, yearly or custom) and due day.
- Illustrative examples:

| Commitment | Amount |
|---|---|
| Room rent | ₹15,000 |
| Furniture rental | ₹3,000 |
| House help | ₹4,000 |
| Money to family | ₹8,000 |
| Gym | ₹2,500 |
| Term insurance | ₹1,500 |
| Streaming subscription | ₹199 |
| Electricity | variable |
| Wifi | variable |
| Phone recharge | variable |

- On the due date, the product creates a **pending entry** the owner confirms with one tap. The owner can edit the amount first, which matters for variable bills like electricity.
- An **Upcoming** view lists commitments due in the next 30 days, with totals.
- Money for commitments not yet paid this month is shown as **reserved**. This reproduces the owner's current habit of "blocking" money for fixed costs at the start of the month.
- The product **detects** likely recurring payments the owner has not defined (same subcategory or note, similar amount, regular interval) and offers to add them.

**AC**
1. A ₹15,000 rent commitment due on the 5th appears as pending on the 5th and becomes a real expense only after confirmation.
2. On the 1st of the month, the Home screen shows reserved money equal to the sum of all commitments due that month.
3. Confirming the electricity pending entry at ₹1,200 when ₹900 was expected records ₹1,200.

### FR-7 Budget rules (M)

- The owner selects a rule. **50/30/20** (Needs/Wants/Savings) is the default. Other presets such as 60/20/20 and 70/20/10 are available.
- The owner can create a **custom rule**:
  - 2 to 6 buckets, custom names, custom percentages that must add up to 100%
  - Each subcategory is assigned to exactly one bucket
- **Rule base** is either:
  - (a) actual income received in the budget month, or
  - (b) a fixed monthly amount the owner sets, for example ₹60,000.
- Savings-type transfers (FR-3) count toward the Savings bucket automatically.
- Any single transaction can be **overridden** to a different bucket, for example one work cab counted as a Need.
- The Budget screen shows, for each bucket:
  - target amount
  - actual so far
  - remaining
  - % of base
  - a pace indicator: on track, at risk, or over
- History shows how the owner performed against the rule for each of the last 6 or more months.

**Business rule:** spending on family (Family & Giving → Family), including regular money sent to family, sits in **Needs** by default (owner decision). Individual transactions can be overridden.

**AC**
1. With a 50/30/20 rule and income of ₹60,001, targets show Needs ₹30,000.50, Wants ₹18,000.30 and Savings ₹12,000.20.
2. Creating a 4-bucket rule with percentages summing to 95% is blocked with a clear message.
3. Overriding one Transport expense from Needs to Wants moves exactly that amount between the two buckets.
4. A ₹25,000 transfer to Fixed Deposit shows in the Savings bucket's actual.

### FR-8 Dashboard (M)

The product has these main areas. Layout is the builder's choice, but the phone must be treated as the primary device.

1. **Home.** A glanceable summary of this month:
   - free money left (income − spent − reserved)
   - spending pace vs a typical month
   - budget buckets at a glance
   - next 3 upcoming bills
   - the **top 3 insights or alerts** right now
2. **Add.** Fast entry (FR-2).
3. **Transactions.** Searchable, filterable list by date range, account, category, bucket, tag, amount and text, with totals for the filtered set.
4. **Insights.** All insights in Section 9, each with a short plain-language headline and a supporting chart or table.
5. **Budget.** The budget rule view (FR-7).
6. **Accounts.** Balances, card dues and the savings/investment summary (FR-1).
7. **Settings.** Categories, rules, recurring commitments, budget month, AI, export and backup, appearance.

**AC**
1. The Home screen answers "How much can I still spend freely this month?" in a single figure visible without scrolling on a phone.
2. Every insight headline is plain language with a number, for example "Rickshaws cost you ₹2,400 this month, about ₹28,800 a year". A bare chart is not enough.
3. Filters on Transactions can be combined, and the total updates instantly.

### FR-9 Native insights (M)

All insights in **Section 9** must be computed by the product itself and work with AI switched off.

**AC**
1. With the AI toggle off, or no key entered, every insight in Section 9 displays correctly.
2. Any insight that needs history the product doesn't have yet shows a friendly "available after N months of data" state instead of an empty or misleading chart.

### FR-10 Optional AI integration (S)

AI is **off by default** and entirely optional. The product must never depend on it.

#### FR-10.1 Setup, as experienced by the owner
1. Settings → AI → **Enable AI** toggle.
2. **Choose provider:** OpenAI, Anthropic, Google Gemini, or **Custom (OpenAI-compatible)**. Custom covers services like OpenRouter or a model running on the owner's own computer, and takes an address plus a key.
3. **Paste API key.** The screen includes short help text on where to get one (each provider's developer console) and a clear note that **an API key is billed separately from ChatGPT Plus, Claude Pro or Gemini subscriptions**.
4. **Test connection** button with clear success or failure messages. Failure messages are human-readable, such as "Key is invalid" or "No credit on this account".
5. **Choose models:** an *everyday model* (cheap, for entry and quick questions) and optionally a *deep model* (for the monthly review). The product lists the models the provider offers.
6. **Privacy level:**
   - *Summaries only*: the AI sees totals and aggregates, never individual transactions.
   - *Full detail*: the AI may see individual transactions.
7. **Monthly AI cost cap** in ₹ or USD, with usage shown against it. When the cap is reached, AI features pause until the next month or until the owner raises the cap.
8. Keys can be replaced or deleted at any time. Keys are **never displayed again** after saving (masked, like `sk-…a1b2`) and are stored securely.

#### FR-10.2 AI features
| ID | Feature | Priority |
|---|---|---|
| AI-1 | **Natural-language entry.** Owner types something like "rick 120, lunch 150 main, ironing 50". AI returns draft transactions for review. **Nothing is saved without the owner's confirmation.** | S |
| AI-2 | **Paste a bank or UPI SMS** or notification text, and get a draft transaction. | S |
| AI-3 | **Ask your money.** Plain-language questions such as "How much did I spend on eating out in August vs July?" or "What did the Goa trip cost per day?" The answer includes the figures and the period used. | S |
| AI-4 | **Monthly review.** A short narrative at month end: what changed, why, how the budget rule went, and 2–3 practical suggestions. It is saved and viewable later. | S |
| AI-5 | **Explain this spike.** On any flagged insight, a button explains which transactions drove it. | C |
| AI-6 | **Receipt or screenshot reading.** Owner uploads a photo or screenshot and gets draft transactions, where the provider supports images. | C |
| AI-7 | **What-if and goals.** "If I cut eating out by half, when do I reach 6 months of emergency fund?" The product computes the scenario and the AI explains it. | C |

#### FR-10.3 AI business rules
- **BR-AI-1.** Every number the AI shows must come from the product's own calculations. The AI must not do its own arithmetic on raw data. If the AI's answer and the product's figures could disagree, the product's figure wins and is shown.
- **BR-AI-2.** The AI only receives data allowed by the chosen privacy level.
- **BR-AI-3.** AI suggestions (categories, entries) are always drafts until the owner accepts them.
- **BR-AI-4.** If AI fails for any reason (bad key, no credit, provider down, cap reached), the product keeps working normally and shows a clear, non-blocking message.
- **BR-AI-5.** Turning AI off or deleting the key removes AI features from the interface. No transaction data is lost. Saved monthly reviews remain readable.

**AC**
1. Entering an invalid key and pressing Test shows "Key is invalid" (or the provider's equivalent) within a few seconds.
2. Typing "rick 120 main" produces a draft: Expense, ₹120, Transport → Rickshaw, account Main Bank, today. It is saved only after confirmation.
3. With privacy set to Summaries only, asking a question produces no request containing individual transaction lines.
4. Asking "How much did I spend on Food last month?" returns exactly the figure shown on the Insights screen.
5. Reaching the cost cap pauses AI features and shows a message. All non-AI features still work.
6. All AI features pass with each of the three named providers.

### FR-11 Export and backup (S)

- The owner can export all data (transactions, accounts, categories, rules, recurring commitments) as a spreadsheet file at any time.
- The owner can export a filtered transaction list.
- The product keeps regular automatic backups, and the owner can restore from one.

**AC**
1. An exported spreadsheet opens in common spreadsheet apps and contains every transaction with date, account, type, category, subcategory, bucket, tags, note, description and amount.

### FR-12 Budget month setting (S)

- The owner can choose when the budget month starts: the 1st of the calendar month (default) or a chosen day, such as salary day.
- All monthly figures, insights and budget rules use this setting consistently.

**AC**
1. Changing the start day to the 3rd recalculates every monthly figure using periods from the 3rd to the 2nd.

### FR-13 Access and privacy (M)

- Only the owner can access the data. A sign-in is required.
- The owner stays signed in on their personal devices until they sign out.
- Data entered on the phone appears on the laptop and vice versa.
- Financial data is never shared with any third party, except the AI provider the owner explicitly configures, within the chosen privacy level.

**AC**
1. An expense added on the phone appears on the laptop after a refresh.
2. Visiting the product while signed out shows no financial data.

### FR-14 History import from the old app (M to build; optional for the owner to use)

**Purpose:** let the owner bring about 3 years of history from the old money-manager app on day one, so every insight, trend and budget history works immediately. It is designed as a one-time migration at the start, but must be safe to run more than once, for example one file per year or a re-run by mistake.

**Where it appears:** nowhere in the product (v1.2). The builder runs the import as a script, and the owner reviews the account and category mappings in a file instead of the screens in FR-14.2. The steps below describe what the script and the review cover.

#### FR-14.1 The file the product must accept
This is the old app's spreadsheet export, in the same format as the sample the owner provided.
- An Excel file (.xlsx) with a sheet named "Money Manager". The same data as .csv must also work.
- **Columns:** Date, Account, Category, Subcategory, Note, INR, Income/Expense, Description, Amount, Currency, Account.
  - "Account" appears twice. The first holds the account name; the last repeats the amount.
- **Date** is a spreadsheet date number, sometimes with a fraction for the time of day. Examples:
  - 46286 = 21 Sep 2026
  - 46297.967082 = 2 Oct 2026, 23:12
- **Type** (the Income/Expense column) values are Income, Expense, Transfer-Out and possibly Transfer-In.
- **For transfers, the Category column holds the destination account name, not a category.** Example: Account = "Main Bank", Category = "Cashback CC", Note = "Payment".
- **Category names start with an emoji and a space** (for example "🍜 Food"). The emoji must be ignored when matching.
- Subcategory may be empty.
- **The file contains categories, subcategories and accounts that no longer exist in the old app.** Over 3 years the owner has deleted and created many of them. The product cannot know these in advance and must discover them from the file itself.
- Future-dated rows can exist, such as "Blocked" transfers planned ahead of time.

#### FR-14.2 Guided import steps
1. **Upload and read.** Show:
   - rows found and date range covered
   - count by type
   - any unreadable rows, with the reason

   Nothing is saved at this step.
2. **Map accounts.**
   - List every distinct account name found, both in the Account column and as transfer destinations. Show the number of rows and the date range for each.
   - For each account, the owner can map it to an existing account, create a new one (choosing its type), or mark it as "not a real account" and choose what happens to its rows.
   - The product suggests a type from the name: names containing "CC" → Credit Card; "Fixed Deposit", "Mutual Fund", "Equity", "Bond", "Emergency" or "Bucket" → Savings/Investment; "Wallet" → Cash.
   - The owner decides how unusual destinations such as "Blocked" or "Loan" are handled.
3. **Map categories.**
   - List every distinct Category + Subcategory pair for expenses and income, **including retired ones**. For each pair, show:
     - number of transactions and total amount
     - first and last date used
     - 3 example notes, to help the owner recognise old categories
   - The product pre-fills suggested mappings using the "Replaces" column in Section 10 wherever names match. Pairs it can't match are left blank for the owner.
   - For each pair, the owner can:
     - map it to an existing subcategory
     - create a new subcategory under any category, with a bucket
     - send it to **Needs review**
   - Bulk selection is supported. **The owner cannot continue until every pair has a choice.**
   - **Note-based rules (S).** A pair can be split using text in the Note or Description. For example, "Other → Spent for others" where the note contains "mom", "papa", "parents" or "family" → Family, and everything else → Friends & others.
   - **Notes to tags (S).** Notes that look like trip or event names ("Goa Trip", "Hill Station Trip", "Water Park Trip") can be turned into tags in one step.
   - **With AI on (C).** AI suggests mappings for unmatched pairs from their names and example notes. These are drafts the owner confirms.
4. **Preview and reconcile.** Before saving, show:
   - totals by year and by type (income, expense, transfer) **from the file vs what will be imported**. These must match exactly, except for rows the owner chose to skip, which are listed.
   - spending per new category per year
   - warnings for future-dated rows, zero or negative amounts, and rows that already exist in the product (see FR-14.3)
5. **Import.** Everything is saved as one **import batch**. Account and category mappings are saved and reused automatically for later files.
6. **Set current balances.** The product calculates each account's balance from the imported history and asks the owner for each account's actual balance today. Any difference is recorded as one **balance adjustment** per account, dated the import day (BR-13).

#### FR-14.3 Import rules
- Imported transactions behave exactly like manually entered ones (BR-14). They can be edited and deleted, and they count in all insights, budget history and tag reports.
- Each imported transaction keeps its **original old category, subcategory and account names** in its details, so any row can be traced back.
- **Duplicates across imports.** A row identical to one already in the product (same date and time, account, type, category, amount and note) is skipped by default and listed. The owner can override this.
- **Duplicates within one file** are imported, because they can be genuine (two identical rides logged together), but they are listed so the owner can check them.
- **Undo.** Any import batch can be removed in one action. This removes exactly its rows and adjustments and restores all balances and insights.
- **Review queue.** Rows sent to Needs review appear in a queue, with a counter on Home, until they are re-categorised.
- **Recurring detection** (FR-6) runs over the imported history and offers the commitments it finds, such as rent, house help, gym and subscriptions.
- **Speed.** Importing 3 years (roughly 10,000–15,000 rows) finishes in about a minute or less, with a progress indicator. Rows are never dropped silently.

**AC**
1. Importing the owner's export gives a reconciliation where totals per type match the file to the paisa, or the difference is fully explained by rows the owner chose to skip.
2. A category pair in the file that isn't in the new taxonomy, including one deleted from the old app, appears in step 3 with its count, total, date range and example notes. The import cannot finish until it is mapped or sent to review.
3. The row "Main Bank → Cashback CC, Payment, ₹12,345.67, Transfer-Out" imports as a transfer, and spending is unchanged.
4. Date 46286 imports as 21 Sep 2026. Date 46297.967082 imports as 2 Oct 2026, 23:12 IST, and is treated as planned (BR-7) if it is later than the import date.
5. "🍜 Food" and "Food" are treated as the same name when matching.
6. Importing the same file twice adds 0 rows the second time and lists all rows as duplicates.
7. With a note rule for "mom", the row "Spent for others, Note: Sent to mom, ₹8,000" goes to Family & Giving → Family, and "Birthday contribution ₹200" goes to Friends & others.
8. Undoing the batch returns the product to exactly its state before the import.
9. After import and entering current balances, each account's balance matches what the owner entered, and balance adjustments appear in no spending or income insight.
10. Right after import, insights that need history (such as INS-04 and INS-05) show values immediately, with no "needs more data" state.

---

## 8. Business Rules

| ID | Rule |
|---|---|
| BR-1 | **Expenses** reduce the account balance and count as spending. |
| BR-2 | **Income** increases the account balance and counts toward the month's income. |
| BR-3 | **Transfers** between own accounts are never counted as spending or income. |
| BR-4 | **Credit card bill payments** are transfers (BR-3). Card spends are counted when made, not when the bill is paid. This prevents double counting. |
| BR-5 | **Transfers into Savings/Investment accounts** count as saved. Transfers out of them count as withdrawals from savings. |
| BR-6 | **Refunds** are recorded against the original category and reduce that category's spending for the month in which they are received. |
| BR-7 | **Future-dated** transactions are *planned*. They appear in Upcoming and in reserved money, but not in actual spending until their date arrives and they are confirmed. |
| BR-8 | **Cashback and interest** are income under "Returns". Cashback credited to a card also reduces that card's outstanding. |
| BR-9 | **Savings rate** = (income − expenses) ÷ income for the budget month. **Invested this month** = total transfers into Savings/Investment accounts. Both are shown. |
| BR-10 | **"Typical month"** = the average of the previous 3 complete budget months, or all available complete months if fewer than 3. |
| BR-11 | All amounts are in INR, shown with the ₹ symbol and Indian grouping (₹1,23,456.78). Figures are accurate to the paisa. |
| BR-12 | Spending on family (Family & Giving → Family) belongs to the **Needs** bucket by default. |
| BR-13 | **Balance adjustments** change account balances only. They never count as spending, income or saving in any insight or budget rule. |
| BR-14 | **Imported transactions** are treated exactly like manually entered ones in every calculation. |

---

## 9. Native Insights Catalogue

Every insight has a **plain-language headline** (with the key number), a supporting visual, and, where relevant, a flag or alert. "Min data" is the history needed before the insight shows. Before that, a friendly waiting state is shown.

| ID | Insight | Definition / rule | Headline example | Min data | Priority |
|---|---|---|---|---|---|
| INS-01 | **Committed vs free money** | Committed = recurring commitments due this budget month. Free = income − committed. Also shows free money left = free − discretionary spent so far. | "₹35,399 of your ₹60,000 salary is committed. ₹24,601 is truly free; ₹12,000 of it is left." | Current month | M |
| INS-02 | **Savings rate** | Per BR-9, shown for this month and as a 6-month trend. | "You saved 25% this month (₹15,000), up from 20% last month." | 1 month | M |
| INS-03 | **Emergency fund coverage** | Emergency Fund balance ÷ average monthly expenses over the last 3 months, in months. | "Your emergency fund covers 2.5 months of expenses." | 1 month | M |
| INS-04 | **Month-to-date pace** | For total spend and each category: spent so far vs typical spend by the same day of the month (typical month prorated by day). Flag if more than 20% ahead. | "Day 10: Food is at 65% of a usual month. You're running hot." | 3 months | M |
| INS-05 | **Category trends** | Each category's month vs its typical month. Flag if ≥ 1.5× typical. Shows month-over-month and 6-month trend. | "Eating out is 1.6× your usual this month." | 2 months | M |
| INS-06 | **Small-spend leak** | Expenses under a threshold (default ₹200, editable) grouped by subcategory: monthly total, count and yearly projection. Top 3 shown. | "Rickshaws: 20 rides, ₹2,400 this month, about ₹28,800 a year." | 1 month | M |
| INS-07 | **Healthy vs junk food** | Healthy food spend vs Junk & treats spend, as a ratio and a trend. | "For every ₹1 on junk, you spent ₹2.50 on healthy food." | 1 month | S |
| INS-08 | **Tracking accuracy** | Lost Track amount and its % of total spend, as a monthly trend. | "₹300 untracked this month (0.5%). Nicely done." | 1 month | S |
| INS-09 | **Subscriptions and recurring** | All recurring payments (defined and detected) with monthly and yearly cost. Flags **price changes** of 1% or more vs the previous charge. | "Your streaming subscription went from ₹149 to ₹199." | 2 occurrences | M |
| INS-10 | **Upcoming bills calendar** | Commitments due in the next 30 days, with totals and reserved money. | "₹30,000 due in the next 10 days." | Commitments defined | M |
| INS-11 | **Credit card overview** | Per card: outstanding, statement and due date, days to due, cashback earned (month and year), and **effective cashback rate** = cashback ÷ card spend. | "Cashback card: ₹12,345.67 due in 6 days. Effective cashback 2.5%." | 1 cycle | S |
| INS-12 | **Payday effect** | Average daily spend in the 7 days after salary vs the rest of the month. | "You spend 1.8× more per day in the week after payday." | 3 months | S |
| INS-13 | **Tag / trip reports** | Per tag: total, number of days, cost per day, breakdown by category and subcategory, and comparison with other trips. | "Goa Trip: ₹18,000 over 6 days, ₹3,000/day; 40% on activities." | Tag used | M |
| INS-14 | **Weekday vs weekend** | Average daily discretionary spend on weekdays vs weekends. | "Weekends cost you ₹600/day vs ₹300 on weekdays." | 2 months | C |
| INS-15 | **Family and giving** | Yearly and monthly totals for Family & Giving, split by subcategory. | "₹75,000 to family so far this year." | 1 month | S |
| INS-16 | **Income mix and stability** | Share of salary, side income, returns and other, plus salary variation month to month. | "Returns earned you ₹1,800 this quarter, 1% of income." | 2 months | C |
| INS-17 | **Budget rule adherence** | See FR-7. Per bucket: target vs actual, pace, and months on or off track. | "Wants at 36% vs 30% target. 3rd month over." | Current month | M |
| INS-18 | **Net position** | Bank + wallet + savings/investment − card dues, with a monthly trend. | "Net position up ₹15,000 this month." | 1 month | S |
| INS-19 | **Top alerts** | The 3 most important flags from all insights above, shown on Home, ordered by rupee impact. | — | — | M |

**AC for the catalogue**
1. Each insight's figure matches a manual calculation from the same transactions to the paisa.
2. Each headline updates immediately after a relevant transaction is added, edited or deleted.
3. No insight counts transfers or credit card bill payments as spending.

---

## 10. Default Category Taxonomy

Default buckets are for the 50/30/20 rule. All of them are editable.

### 10.1 Expense categories (8)

| Category | Subcategory | Default bucket | Replaces (old app) |
|---|---|---|---|
| **Home** | Rent | Needs | Bills → Rent (room) |
| | Furniture & appliance rental | Needs | Bills → Rent (furniture rental) |
| | House help | Needs | Bills → Househelp |
| | Electricity | Needs | Bills → Utility |
| | Internet | Needs | Bills → Utility (Wifi) |
| | Cooking gas | Needs | Household → Kitchen (Gas) |
| | Maintenance & repairs | Needs | Bills → Maintenance |
| **Food** | Groceries | Needs | Food → Groceries, Fruits, Water |
| | Healthy food | Needs | Health → Food, Health → Protein (food items), Food → Snacks (Healthy) |
| | Eating out | Wants | Food → Eating out, Online order, Breakfast, Lunch, Dinner, Beverages |
| | Junk & treats | Wants | Food → Junk |
| **Transport** | Rickshaw | Needs | Transport → Rikshaw |
| | Bus | Needs | Transport → Bus |
| | Train & metro | Needs | Transport → Local, Metro |
| | Cab & bike taxi | Wants | Transport → Taxi |
| | Fuel | Needs | Transport → Petrol |
| **Health** | Medical | Needs | Hospital → Doctor, Medicine, Tests |
| | Insurance | Needs | Bills → Policy |
| | Gym & training | Wants | Health → Gym |
| | Supplements & protein | Wants | Health → Supplements, Protein (powders) |
| **Personal** | Clothing & shoes | Wants | Apparel → Clothing, Shoes |
| | Laundry & ironing | Needs | Apparel → Ironing |
| | Grooming & skincare | Wants | Beauty → Haircut, Others, Perfumes |
| | Toiletries & home supplies | Needs | Household → Toiletries, Kitchen, Others |
| | Gadgets & personal items | Wants | Things → Personal, Gadgets; Household → Furniture |
| | Documents & admin | Needs | Passport, Aadhaar, photocopies |
| **Bills** | Phone | Needs | Phone → Recharge |
| | Subscriptions | Wants | Bills → Subscription |
| | Bank fees & taxes | Needs | Bills → Taxes, demat/bank charges |
| **Fun & Travel** | Trips | Wants | Travel → all subcategories (use **tags** for each trip) |
| | Movies & events | Wants | Activities → Movie |
| | Games & sports | Wants | Activities → Games, Activity (turf, swimming, badminton, bowling) |
| **Family & Giving** | Family | Needs | Other → Spent for others, where it was for family (sent to mom, for papa, for parents, for family) |
| | Friends & others | Wants | Other → Spent for others for friends or colleagues, birthday contributions, treats |
| | Donations | Wants | Other → Donated |
| *(system)* | **Lost Track** | Wants | Other → Misc (Lost Track) |

Notes:
- **Family** is deliberately broad. It covers any money spent on or sent to family, not only support. Examples: regular money transfers to family, things bought for parents, tickets booked for family members, family outings. The default bucket is Needs; individual transactions (for example a gift) can be moved to Wants.
- The "Replaces (old app)" column is also the starting point for suggested mappings during history import (FR-14). It only covers the old categories visible in the sample. Retired categories found in the full export are mapped by the owner during import.
- Trip breakdowns (stay, food, travel, activities, shopping) come from logging trip spends in their normal categories **and** adding the trip tag, *or* using Fun & Travel → Trips with a tag. The builder may choose either approach, provided INS-13 can show a per-category breakdown for each trip.

### 10.2 Income categories (4)
| Category | Includes |
|---|---|
| **Salary** | Monthly salary |
| **Side income** | Freelance, prizes, selling items |
| **Returns** | Interest, cashback, bond interest |
| **Other** | Bonus, balance adjustments, anything else |

### 10.3 Savings / Investment account types (for FR-3)
Fixed Deposit, Mutual Fund, Equity, Bond, Emergency Fund, Travel Fund (sinking funds). The owner can add more.

---

## 11. Non-Functional Requirements (plain language)

| ID | Requirement |
|---|---|
| NFR-1 | **Phone first.** Every screen is fully usable one-handed on a phone. The laptop view makes good use of the wider screen. |
| NFR-2 | **Installable.** The product can be added to the phone home screen and opened like an app. |
| NFR-3 | **Fast.** Screens open and entries save with no noticeable wait on a normal mobile connection. Home loads in about 2 seconds or less. |
| NFR-4 | **Reliable entry.** An entry is never lost. If the connection drops while saving, the product saves it as soon as the connection returns, or tells the owner clearly that it wasn't saved. |
| NFR-5 | **Accurate.** All money figures are exact to the paisa and consistent across every screen and export. |
| NFR-6 | **Private and secure.** Data and API keys are protected. Only the owner can see them. |
| NFR-7 | **Readable.** Light and dark mode, clear contrast, and no jargon in headlines. |
| NFR-8 | **Scales with history.** Stays fast with 10+ years of daily entries (about 40,000 transactions). |
| NFR-9 | **Low running cost.** Suitable for a single personal user. AI costs are paid by the owner's own key and capped (FR-10.1). |

---

## 12. Release Plan

| Phase | Contents | Exit criteria |
|---|---|---|
| **Phase 1: Replace the old app** | FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-13, **FR-14 (history import)**; INS-01 to INS-06, INS-09, INS-10, INS-13, INS-17, INS-19 | The owner's full history imports and reconciles with the file. Owner logs everything here for 2 weeks without going back to the old app. All Phase 1 AC pass. |
| **Phase 2: Deeper insight and AI** | FR-9 (remaining insights), FR-10 with AI-1 to AI-4, FR-11, FR-12 | All Phase 2 AC pass with each of OpenAI, Anthropic and Gemini. |
| **Phase 3: Nice to have** | AI-5 to AI-7, INS-14, INS-16, any polish | Owner sign-off. |

---

## 13. User Acceptance Test Scenarios

Use these scenarios, based on the owner's real patterns, to confirm the product works end to end.

| # | Scenario | Expected result |
|---|---|---|
| UAT-1 | Open the product on a phone and log "Rickshaw ₹120 from Main Bank". | Saved in under 10 seconds. Transport → Rickshaw. Main Bank balance down ₹120. |
| UAT-2 | Log a grocery run as 3 lines: Groceries ₹300, Healthy food ₹450, Toiletries ₹250 on one card. | Three transactions, same date and time, correct categories, total ₹1,000. |
| UAT-3 | Record salary of ₹60,000 on the 1st. Commitments defined: rent 15,000, furniture rental 3,000, house help 4,000, family 8,000, gym 2,500, insurance 1,500, streaming 199, electricity 1,200. | INS-01 shows committed ₹35,399 and free ₹24,601. |
| UAT-4 | Pay the Cashback card bill of ₹12,345.67 from Main Bank. | Monthly spending unchanged. Card outstanding and Main Bank balance both reduced by ₹12,345.67. |
| UAT-5 | Transfer ₹10,000 to Mutual Fund and ₹25,000 to Fixed Deposit. | "Invested this month" = ₹35,000. Savings bucket actual includes ₹35,000. Not in expenses. |
| UAT-6 | Apply 50/30/20 with income ₹60,001. | Targets ₹30,000.50 / ₹18,000.30 / ₹12,000.20. Money sent to family counted in Needs. |
| UAT-7 | Switch to a custom rule: Needs 55 / Wants 25 / Savings 20. | All targets and history recalculate. |
| UAT-8 | Log a streaming subscription at ₹149 one month and ₹199 the next. | Price change flagged in INS-09. |
| UAT-9 | Tag 12 transactions "Goa Trip" across 6 days. | Trip report shows total, ₹/day, category breakdown. |
| UAT-10 | Log 20 rickshaw rides averaging ₹120 in a month. | INS-06 lists rickshaw in the top 3 with the monthly total and yearly projection. |
| UAT-11 | With AI off, open every insight. | All insights work (or show "needs more data" where history is short). |
| UAT-12 | Turn AI on with an Anthropic key, then repeat with OpenAI and Gemini. Type "lunch 150, ironing 50 main". | Two draft transactions appear. Nothing saves until confirmed. Works with all three providers. |
| UAT-13 | Enter a wrong API key and press Test. | Clear failure message. All non-AI features unaffected. |
| UAT-14 | Ask AI: "How much did I spend on Food last month?" | Answer matches the Insights figure exactly. |
| UAT-15 | Delete the AI key. | AI features disappear. No data lost. Past monthly reviews still readable. |
| UAT-16 | Add an expense on the phone, then open the laptop. | The expense appears on the laptop. |
| UAT-17 | Log a future-dated rent entry for next month. | Shows in Upcoming and reserved money, not in this month's spending. |
| UAT-18 | Export all data. | Spreadsheet contains every transaction with all fields listed in FR-11. |
| UAT-19 | Run the import script on the full export. | Every distinct account and category pair is listed, including retired ones, with counts, totals, date ranges and example notes. |
| UAT-20 | Map "Other → Spent for others" with a note rule ("mom", "papa", "parents", "family" → Family; else → Friends & others). Turn trip notes into tags. | Rows split correctly. Trips appear as tags with working trip reports. |
| UAT-21 | Review the preview and finish the import. | File totals and imported totals match per year and type, or differences are fully explained by skipped rows. |
| UAT-22 | Enter today's real balance for each account. | Balances match. Adjustments do not appear in any insight. |
| UAT-23 | Open Insights right after importing. | Trends, pace and budget history show 3 years of data immediately. |
| UAT-24 | Import the same file again. | 0 new rows. All rows listed as duplicates. |
| UAT-25 | Undo the import batch. | Product returns exactly to its pre-import state. |

---

## 14. Assumptions and Open Questions

### Assumptions
- A1. Single user, INR only, India (IST).
- A2. The owner will most likely import about 3 years of history at the start (FR-14), so insights work from day one. If the owner chooses **Start fresh** instead, insights that need history "warm up" over the first 1–3 months (FR-9 AC-2).
- A5. The old app's export format matches the sample the owner provided. Categories and accounts in the full export may differ from the sample and are handled by the mapping steps in FR-14.
- A3. The owner accepts paying their own AI provider costs.
- A4. Investment accounts track money moved in and out, not market value.

### Open questions (the builder may proceed with the stated default)
| # | Question | Default if unanswered |
|---|---|---|
| Q1 | Should shared or reimbursed expenses be supported? (For example, an expense paid in full and later partly repaid by someone else.) | Not in v1. The owner logs only their own share. Revisit after Phase 1. |
| Q2 | Should the budget month start on salary day instead of the 1st? Salary may not arrive on the 1st. | Calendar month (1st), changeable in settings (FR-12). |
| Q3 | Is Gym & training a Need or a Want? | Want, editable. |
| Q4 | Small-spend threshold for INS-06? | ₹200, editable. |
| Q5 | Should the owner get notifications (bill due, overspending alert)? | Not in v1. Alerts appear on the Home screen only. |

---

## 15. Definition of Done

The product is complete for a phase when:
1. Every Must requirement in that phase is built and all its acceptance criteria pass.
2. All UAT scenarios relevant to that phase pass on a phone and a laptop.
3. All figures on all screens reconcile exactly with a manual calculation.
4. The product works fully with AI switched off.
5. The owner has used it as their only money tracker for 2 consecutive weeks (Phase 1) and signs off.
