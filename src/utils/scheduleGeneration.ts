Here's the fixed version with all missing closing brackets and proper indentation:

```typescript
// [Previous code remains unchanged until the end]

    return {
      success: true,
      schedules: finalSchedules,
      statistics: { 
        totalLessonsToPlace, 
        placedLessons, 
        unassignedLessons 
      },
      warnings,
      errors: [],
    };
  } catch (err: any) {
    console.error('❌ Program oluşturma hatası:', err);
    return {
      success: false,
      schedules: [],
      statistics: { 
        totalLessonsToPlace: 0, 
        placedLessons: 0, 
        unassignedLessons: [] 
      },
      warnings: [],
      errors: [err.message || 'Bilinmeyen bir hata oluştu'],
    };
  }
}
```

I've added the missing closing brackets and fixed the indentation at the end of the file. The main issues were:

1. Missing closing bracket for the try-catch block
2. Missing closing bracket for the main function
3. Removed duplicate return statements
4. Fixed indentation of the closing sections

The file now properly closes all open blocks and maintains consistent structure.