# Homework Assignments Feature - Implementation Guide

## Overview

A complete homework assignments management system has been added to the MindBox Companion app, allowing students to upload, track, and manage their homework with file attachments.

## Features Implemented

### 1. **Database Layer** (`supabase/migrations/0012_homework_assignments.sql`)

- New `homework_assignments` table with the following columns:
  - `id`: Unique identifier (UUID)
  - `user_id`: Reference to student (profile)
  - `course_code`: Optional course identifier
  - `title`: Assignment name
  - `description`: Optional assignment details
  - `due_date`: Due date (YYYY-MM-DD format)
  - `status`: One of 'pending', 'submitted', or 'graded'
  - `file_url`: URL to uploaded file (stored in Supabase Storage)
  - `file_name`: Name of uploaded file
  - `file_size_bytes`: Size of file in bytes
  - `grade`: Optional grade/score
  - `notes`: Optional notes from teacher/grader
  - `created_at` & `updated_at`: Timestamps

- **RLS Policy**: Students can only access their own assignments
- **Indexes**: Optimized queries on user_id, due_date, status, and course_code
- **File Size Limit**: 25 MB per file (enforced at application level)

### 2. **Type Definitions** (`src/lib/types.ts`)

```typescript
type HomeworkStatus = "pending" | "submitted" | "graded";

interface HomeworkAssignment {
  id: string;
  courseCode: string | null;
  title: string;
  description: string | null;
  dueDate: string;
  status: HomeworkStatus;
  fileUrl: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  grade: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### 3. **Query Hooks** (`src/lib/queries/homework.ts`)

- `useHomeworkAssignments()`: Fetch all assignments for current user
- `useHomeworkActions()`: CRUD mutations
  - `add`: Add new assignment with optional file upload
  - `update`: Update assignment with new file
  - `remove`: Delete assignment

Features:

- Automatic file upload to Supabase Storage
- File size validation (25 MB limit)
- Query invalidation on mutations
- Error handling with descriptive messages

### 4. **Components** (`src/features/homework/components/`)

#### HomeworkDialog.tsx

- Create and edit assignment dialogs
- File upload with file size display
- Form validation
- Status selection (pending/submitted/graded)

#### HomeworkCard.tsx

- Display individual assignment cards
- Visual status indicators with color coding
- File download capability
- Edit/delete buttons
- Overdue warning (red background for pending assignments past due date)
- Grade display
- File size display

### 5. **Route** (`src/routes/assignments.tsx`)

- Full assignments management page
- Assignments organized by status (Pending, Submitted, Graded)
- Quick add button
- Empty state message
- Error handling
- Sort by due date

### 6. **Navigation** (`src/components/AppShell.tsx`)

- Added "Assignments" menu item with BookOpen icon
- Positioned after Calendar in navigation
- Available in both desktop and mobile navigation

## Setup Instructions

### Step 1: Run Database Migration

1. Go to Supabase Dashboard → SQL Editor
2. Create a new query and paste the contents of `supabase/migrations/0012_homework_assignments.sql`
3. Execute the query
4. You should see: "Parsed SQL: 11 queries. Executing them now..."

### Step 2: Create Storage Bucket

1. Go to Supabase Dashboard → Storage
2. Click "Create a new bucket"
3. Name it: `homework-files`
4. Make it **Private** (security: users can only access their own files)
5. Click "Create bucket"
6. Set the following policy (Column Policy):
   - Click on the bucket → Policies
   - Add SELECT policy: `SELECT ((storage.foldername(name))[1] = auth.uid()::text)`
   - Add INSERT/UPDATE/DELETE policies with the same condition

### Step 3: Verify Types and Imports

All files should import correctly. The feature uses:

- React Query for state management
- Supabase Client for database and storage
- React Hook Form patterns for validation
- Tailwind CSS with shadcn/ui components

## Usage

### For Students:

1. Navigate to **Assignments** in the main menu
2. Click **+ Add assignment**
3. Fill in:
   - Title (required)
   - Course code (optional)
   - Due date (required)
   - Status (pending/submitted/graded)
   - Description
   - Notes
   - File upload (optional, max 25 MB)
4. Click **Add assignment**

### Updating an Assignment:

1. Find the assignment card
2. Click the **Edit** button
3. Modify fields (upload a new file to replace the old one)
4. Click **Update assignment**

### Deleting an Assignment:

1. Find the assignment card
2. Click the **Delete** button
3. The assignment will be removed

### Downloading Files:

1. Click the **Download** button on any assignment card with an attached file
2. The file opens in a new tab

## Data Structure Example

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "auth_user_id",
  "course_code": "CS101",
  "title": "Chapter 5 Exercises",
  "description": "Complete all exercises from chapter 5",
  "due_date": "2026-06-30",
  "status": "pending",
  "file_url": "https://supabase_url/storage/v1/object/public/homework-files/...",
  "file_name": "Chapter5_Exercises.pdf",
  "file_size_bytes": 2048576,
  "grade": null,
  "notes": null,
  "created_at": "2026-06-26T10:30:00Z",
  "updated_at": "2026-06-26T10:30:00Z"
}
```

## File Structure

```
src/
├── features/homework/
│   └── components/
│       ├── HomeworkDialog.tsx    # Add/edit dialog
│       └── HomeworkCard.tsx      # Assignment card display
├── lib/
│   ├── queries/homework.ts       # Query hooks and mutations
│   └── types.ts                  # TypeScript definitions
├── routes/
│   └── assignments.tsx           # Main page
└── components/
    └── AppShell.tsx              # Navigation menu (updated)

supabase/migrations/
└── 0012_homework_assignments.sql # Database schema
```

## Important Notes

### File Upload Security

- Files are stored in a private Supabase Storage bucket
- RLS policies ensure users can only access their own files
- File size is limited to 25 MB to prevent abuse
- File names are prepended with user_id and timestamp for security

### Overdue Indicators

- Assignments with `due_date` in the past and `status: "pending"` show with a red background
- The due date displays "X days ago" format

### Status Management

The three status levels allow tracking:

- **Pending**: Not yet submitted
- **Submitted**: Handed in, awaiting grades
- **Graded**: Graded by instructor with optional score

## Troubleshooting

### "Failed to upload file" error

- Check if storage bucket exists and is named `homework-files`
- Verify storage bucket policies are set correctly
- Ensure file size is under 25 MB

### "You must be signed in" error

- User needs to be authenticated first
- Verify auth context is working (login required)

### Files not showing in public URL

- Check storage bucket permissions
- Verify the file was uploaded successfully
- Check if the file path in database matches storage path

## Future Enhancements

Consider adding:

- Batch upload for multiple files
- File preview (PDF, images)
- Assignment templates/rubrics
- Submission history and versioning
- Email notifications for due dates
- Integration with calendar for due date visualization
- Collaborative assignments
- Peer review features

---

**Migration Version**: 0012
**Created**: 2026-06-26
