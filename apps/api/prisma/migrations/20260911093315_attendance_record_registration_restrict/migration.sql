-- DropForeignKey
ALTER TABLE "attendance_record" DROP CONSTRAINT "attendance_record_registration_id_fkey";

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
