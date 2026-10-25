const categories = [
  'Academics', 'Administration', 'Finance/Accounts', 'Examination', 'Transport',
  'Student Welfare and Discipline', 'Placement/Internship', 'Library',
  'LMS/Portal Issues', 'Hostel', 'General Feedback/Suggestion', 'Other'
];
const subcategories = {
  Academics: ['Attendance Issues', 'Teaching Feedback', 'Curriculum / Syllabus', 'Student Leave', 'Academic Projects', 'Other Academic Issues'],
  Administration: ['Document / Certificate', 'Student Records', 'Office Service', 'Communication', 'Other Administrative Issue'],
  'Finance/Accounts': ['Fee Payment', 'Refund', 'Scholarship', 'Incorrect Charges', 'Other'],
  Examination: ['Examination Form', 'Admit Card', 'Result Issues', 'Marks Correction', 'Examination Schedule', 'Other'],
  Transport: ['Bus Route', 'Bus Pass', 'Timing Issue', 'Safety Concern', 'Other'],
  'Student Welfare and Discipline': ['Anti-Ragging', 'Conduct Concern', 'Counselling Support', 'Student Safety', 'Other'],
  'Placement/Internship': ['Placement Drive', 'Internship Letter', 'Company Coordination', 'Career Guidance', 'Other'],
  Library: ['Book Issue / Return', 'Library Card', 'Resources', 'Opening Hours', 'Other'],
  'LMS/Portal Issues': ['Unable to Log In', 'Account Not Active', 'Password / Access Issues', 'LMS Content Issues', 'Portal Not Working', 'Other'],
  Hostel: ['Room Allocation', 'Maintenance', 'Mess Service', 'Security Concern', 'Other'],
  'General Feedback/Suggestion': ['Campus Suggestion', 'Service Feedback', 'Event Feedback', 'Other'],
  Other: ['General / Other']
};
const statuses = ['Submitted', 'Under Review', 'In Progress', 'Waiting for Student', 'Resolved', 'Closed'];
const allowedTransitions = {
  Submitted: ['Under Review'],
  'Under Review': ['In Progress', 'Waiting for Student'],
  'In Progress': ['Waiting for Student', 'Resolved'],
  'Waiting for Student': ['In Progress', 'Resolved'],
  Resolved: ['Closed', 'In Progress'],
  Closed: ['In Progress']
};

function validateComplaint(body) {
  const required = ['category', 'subcategory', 'title', 'description'];
  const missing = required.filter((key) => !String(body[key] || '').trim());
  if (missing.length) return `Missing: ${missing.join(', ')}`;
  if (!categories.includes(body.category)) return 'Invalid category';
  if (!subcategories[body.category]?.includes(body.subcategory)) return 'Invalid subcategory for selected category';
  if (String(body.title).length > 160 || String(body.description).length > 5000) return 'Complaint text is too long';
  return null;
}

function validateProfile(body) {
  const required = ['name', 'studentUid', 'fatherGuardianName', 'course', 'semester', 'mobileNumber'];
  const missing = required.filter((key) => !String(body[key] || '').trim());
  if (missing.length) return `Missing: ${missing.join(', ')}`;
  if (!/^[6-9]\d{9}$/.test(String(body.mobileNumber).trim())) return 'Enter a valid 10-digit Indian mobile number';
  return null;
}

module.exports = { categories, subcategories, statuses, allowedTransitions, validateComplaint, validateProfile };
