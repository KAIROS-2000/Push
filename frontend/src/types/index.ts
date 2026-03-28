export type UserRole = 'student' | 'teacher' | 'admin' | 'superadmin'
export type ProgressStatus = 'not_started' | 'in_progress' | 'pending_review' | 'needs_revision' | 'completed'
export type SubmissionStatus = 'submitted' | 'pending_review' | 'checked' | 'needs_revision'
export type TaskEvaluationMode = 'manual' | 'keywords' | 'stdin_stdout'
export type CodeTaskLanguage = 'python' | 'javascript'

export interface UserItem {
  id: number
  full_name: string
  username: string
  email: string
  role: UserRole
  age_group: string | null
  xp: number
  level: number
  rank_title: string
  xp_to_next: number
  streak: number
  theme: 'light' | 'dark'
  is_active: boolean
}

export interface LessonSummary {
  id: number
  slug: string
  title: string
  summary: string
  duration_minutes: number
  passing_score: number
  order_index: number
  module_title?: string
  is_custom?: boolean
  custom_classroom_id?: number | null
  state?: 'completed' | 'current' | 'locked' | 'open'
  progress?: ProgressItem | null
}

export interface ProgressItem {
  id: number
  user_id: number
  lesson_id: number
  status: ProgressStatus
  score: number
  attempts: number
  hints_used: number
  completed_at: string | null
}

export interface ModuleItem {
  id: number
  slug: string
  title: string
  description: string
  age_group: string
  icon: string
  color: string
  order_index: number
  is_published: boolean
  is_custom_classroom_module?: boolean
  custom_classroom_id?: number | null
  lessons: LessonSummary[]
}

export interface TheoryBlock {
  type: string
  title: string
  text?: string
  items?: string[]
}

export interface InteractiveStep {
  title: string
  text: string
}

export interface TaskItem {
  id: number
  task_type: string
  title: string
  prompt: string
  starter_code: string
  validation: {
    evaluation_mode: TaskEvaluationMode
    runner?: 'stdin_stdout' | null
    language?: CodeTaskLanguage | null
    keywords?: string[]
    tests_count?: number
    time_limit_ms?: number | null
    memory_limit_mb?: number | null
  }
  hints: string[]
  xp_reward: number
}

export interface JudgeResultItem {
  label: string
  input: string
  expected: string
  actual: string
  stderr?: string | null
  passed: boolean
  duration_ms: number
  error_type?: 'timeout' | 'compile_error' | 'runtime_error' | null
}

export interface JudgeReport {
  mode: TaskEvaluationMode
  runner?: 'stdin_stdout' | null
  language?: CodeTaskLanguage | null
  passed: boolean
  score: number
  feedback: string
  tests_passed?: number
  tests_total?: number
  results?: JudgeResultItem[]
  compile_error?: string | null
  runtime_error?: string | null
  keyword_matches?: string[]
  missing_keywords?: string[]
  time_limit_ms?: number | null
  memory_limit_mb?: number | null
}

export interface QuizQuestion {
  id: string
  type: 'single' | 'multiple' | 'order' | 'match' | 'text'
  prompt: string
  options?: string[]
  items?: string[]
  left?: string[]
  right?: string[]
  correct?: unknown
}

export interface QuizItem {
  id: number
  title: string
  passing_score: number
  questions: QuizQuestion[]
  xp_reward: number
}

export interface LessonDetail extends LessonSummary {
  module: ModuleItem
  content_format: string
  theory_blocks: TheoryBlock[]
  interactive_steps: InteractiveStep[]
  tasks: TaskItem[]
  quizzes: QuizItem[]
}

export type LessonChatRole = 'user' | 'assistant'

export interface LessonChatMessage {
  role: LessonChatRole
  content: string
}

export interface LessonChatUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export interface LessonGigaChatResponse {
  message: LessonChatMessage
  model?: string | null
  usage?: LessonChatUsage | null
}

export interface DashboardData {
  user: UserItem
  summary: {
    completed_lessons: number
    assignments_open: number
    achievements: number
  }
  continue_lesson: LessonSummary & { module_title: string } | null
  daily_quests: Array<{ id: string; title: string; xp: number; completed: boolean }>
  recent_achievements: Array<{ id: number; name: string; description: string; xp_reward: number }>
  my_classes: ClassroomItem[]
  assignments_preview: AssignmentItem[]
  parent_invite: ParentInvite | null
}

export interface AuthOptions {
  roles: string[]
  age_groups: string[]
}

export interface ClassroomItem {
  id: number
  name: string
  description: string
  code: string
  teacher_id: number
  students_count: number
  assignments_count: number
}

export interface AssignmentItem {
  id: number
  classroom_id: number
  lesson_id: number | null
  title: string
  description: string
  difficulty: string
  due_date: string | null
  xp_reward: number
  assignment_type: 'lesson_practice' | 'mini_project' | 'quiz' | 'reflection'
  assignment_type_label: string
  submission_format: 'text' | 'code' | 'link' | 'mixed'
  lesson?: LessonSummary | null
  lesson_url?: string | null
  classroom_name?: string
  submissions_count?: number
  checked_count?: number
  lesson_state?: 'completed' | 'current' | 'locked' | 'open' | null
  lesson_accessible?: boolean
  submission?: SubmissionItem | null
}

export interface LessonCatalogItem extends LessonSummary {
  lesson_url: string
  module_age_group: 'junior' | 'middle' | 'senior'
  source: 'catalog' | 'teacher'
  source_label: string
}

export interface SubmissionItem {
  id: number
  assignment_id: number
  student_id: number
  student_username: string
  answer: string | null
  score: number
  status: SubmissionStatus
  feedback?: string | null
  submitted_at: string
}

export interface TeacherOverviewData {
  summary: {
    classes: number
    students: number
    assignments: number
    submissions: number
  }
  classes: ClassroomItem[]
}

export interface TeacherClassDetail {
  classroom: ClassroomItem
  students: Array<{
    id: number
    username: string
    full_name: string
    xp: number
    level: number
    completed_lessons: number
    average_score: number
  }>
  assignments: AssignmentItem[]
}

export interface ParentInvite {
  id: number
  student_id: number
  code: string
  label: string
  active: boolean
  weekly_limit_minutes: number | null
  modules_whitelist: string[]
  expires_at: string | null
  created_at: string
}

export interface ParentAccessData {
  invite: ParentInvite
  child: UserItem
  summary: {
    completed_lessons: number
    average_score: number
    tasks_submitted: number
    current_level: number
    xp: number
    streak: number
  }
  weekly_activity: Array<{
    date: string
    label: string
    lessons: number
    assignments: number
    average_score: number
  }>
  modules: Array<{
    id: number
    title: string
    color: string
    completed_lessons: number
    total_lessons: number
    progress_percent: number
  }>
  recent_achievements: Array<{ id: number; name: string; description: string; xp_reward: number }>
  recent_assignments: SubmissionItem[]
}
