import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { insertCompanionSchema } from "@shared/schema";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Upload,
  Shield,
  Camera,
  FileText,
  MapPin,
  Globe,
  Heart,
  DollarSign,
  X,
  Plus
} from "lucide-react";

const formSchema = insertCompanionSchema.extend({
  displayName: z.string().min(2, "Name must be at least 2 characters"),
  bio: z.string().min(50, "Bio must be at least 50 characters"),
  age: z.number().min(18, "Must be at least 18 years old").max(65, "Must be under 65"),
  city: z.string().min(2, "City is required"),
  ratePerMinute: z.string().min(1, "Rate is required"),
}).omit({
  userId: true,
  id: true,
  createdAt: true,
  updatedAt: true,
});

type FormData = z.infer<typeof formSchema>;

const languages = [
  'Hindi', 'English', 'Bengali', 'Telugu', 'Marathi', 'Tamil', 'Gujarati', 
  'Urdu', 'Kannada', 'Odia', 'Malayalam', 'Punjabi'
];

const interests = [
  'Music', 'Movies', 'Books', 'Travel', 'Technology', 'Sports', 'Art', 
  'Cooking', 'Gaming', 'Fashion', 'Photography', 'Dancing', 'Fitness',
  'Business', 'Career', 'Education', 'Spirituality'
];

export default function ProfileVerification() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [uploadedPhotos, setUploadedPhotos] = useState<File[]>([]);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      displayName: "",
      bio: "",
      age: 18,
      city: "",
      languages: [],
      interests: [],
      ratePerMinute: "15",
      availabilityStatus: "offline",
      verificationStatus: "pending",
      profilePhotos: [],
    },
  });

  const createProfileMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const formData = new FormData();
      
      // Append form fields
      Object.entries(data).forEach(([key, value]) => {
        if (key === 'languages' || key === 'interests') {
          formData.append(key, JSON.stringify(value));
        } else {
          formData.append(key, value?.toString() || '');
        }
      });

      // Append photos
      uploadedPhotos.forEach((photo) => {
        formData.append('photos', photo);
      });

      return await apiRequest('POST', '/api/companions', formData, {
        headers: {
          // Don't set Content-Type, let browser set it with boundary for FormData
        },
      });
    },
    onSuccess: () => {
      toast({
        title: "Profile Created Successfully!",
        description: "Your companion profile is under review. You'll be notified once verified.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      setLocation('/companion');
    },
    onError: (error) => {
      toast({
        title: "Profile Creation Failed",
        description: "Please check all fields and try again.",
        variant: "destructive",
      });
    },
  });

  const handleLanguageToggle = (language: string) => {
    const updated = selectedLanguages.includes(language)
      ? selectedLanguages.filter(l => l !== language)
      : [...selectedLanguages, language];
    
    setSelectedLanguages(updated);
    form.setValue('languages', updated);
  };

  const handleInterestToggle = (interest: string) => {
    const updated = selectedInterests.includes(interest)
      ? selectedInterests.filter(i => i !== interest)
      : [...selectedInterests, interest];
    
    setSelectedInterests(updated);
    form.setValue('interests', updated);
  };

  const handlePhotoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (uploadedPhotos.length + files.length > 5) {
      toast({
        title: "Too Many Photos",
        description: "You can upload maximum 5 photos.",
        variant: "destructive",
      });
      return;
    }

    setUploadedPhotos(prev => [...prev, ...files]);
  };

  const removePhoto = (index: number) => {
    setUploadedPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const onSubmit = (data: FormData) => {
    const finalData = {
      ...data,
      languages: selectedLanguages,
      interests: selectedInterests,
    };
    createProfileMutation.mutate(finalData);
  };

  const nextStep = async () => {
    const isValid = await form.trigger();
    if (isValid && currentStep < 4) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleLogout = () => {
    window.location.href = "/api/logout";
  };

  return (
    <div className="min-h-screen p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Complete Your Profile</h1>
          <p className="text-muted-foreground">Step {currentStep} of 4</p>
        </div>
        <Button variant="ghost" onClick={handleLogout} data-testid="button-logout">
          Logout
        </Button>
      </div>

      {/* Progress Bar */}
      <div className="mb-8">
        <Progress value={(currentStep / 4) * 100} className="h-2" />
      </div>

      <div className="max-w-2xl mx-auto">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            
            {/* Step 1: Basic Information */}
            {currentStep === 1 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <FileText className="w-5 h-5 mr-2" />
                    Basic Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="displayName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Display Name</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="How you want to be known to clients" 
                            {...field} 
                            data-testid="input-display-name"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="age"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Age</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            {...field} 
                            onChange={e => field.onChange(parseInt(e.target.value))}
                            data-testid="input-age"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="Your current city" 
                            {...field} 
                            data-testid="input-city"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="bio"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bio</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Tell clients about yourself, your interests, and what makes you a great companion..."
                            className="min-h-[100px]"
                            {...field} 
                            data-testid="textarea-bio"
                          />
                        </FormControl>
                        <FormDescription>
                          Minimum 50 characters. This will be visible to clients.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            )}

            {/* Step 2: Languages & Interests */}
            {currentStep === 2 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Heart className="w-5 h-5 mr-2" />
                    Languages & Interests
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <FormLabel className="flex items-center mb-3">
                      <Globe className="w-4 h-4 mr-2" />
                      Languages You Speak
                    </FormLabel>
                    <div className="flex flex-wrap gap-2">
                      {languages.map((language) => (
                        <Badge
                          key={language}
                          variant={selectedLanguages.includes(language) ? "default" : "outline"}
                          className="cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => handleLanguageToggle(language)}
                          data-testid={`language-${language.toLowerCase()}`}
                        >
                          {language}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">
                      Select at least one language
                    </p>
                  </div>

                  <div>
                    <FormLabel className="flex items-center mb-3">
                      <Heart className="w-4 h-4 mr-2" />
                      Your Interests
                    </FormLabel>
                    <div className="flex flex-wrap gap-2">
                      {interests.map((interest) => (
                        <Badge
                          key={interest}
                          variant={selectedInterests.includes(interest) ? "default" : "outline"}
                          className="cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => handleInterestToggle(interest)}
                          data-testid={`interest-${interest.toLowerCase()}`}
                        >
                          {interest}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">
                      Select topics you enjoy discussing
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Step 3: Photos */}
            {currentStep === 3 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Camera className="w-5 h-5 mr-2" />
                    Profile Photos
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="hidden"
                      id="photo-upload"
                      data-testid="input-photos"
                    />
                    <label htmlFor="photo-upload" className="cursor-pointer">
                      <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm font-medium">Upload Profile Photos</p>
                      <p className="text-xs text-muted-foreground">
                        Add up to 5 high-quality photos (JPEG, PNG)
                      </p>
                    </label>
                  </div>

                  {uploadedPhotos.length > 0 && (
                    <div className="grid grid-cols-3 gap-4">
                      {uploadedPhotos.map((photo, index) => (
                        <div key={index} className="relative">
                          <img
                            src={URL.createObjectURL(photo)}
                            alt={`Upload ${index + 1}`}
                            className="w-full h-24 object-cover rounded-lg"
                          />
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon"
                            className="absolute -top-2 -right-2 w-6 h-6"
                            onClick={() => removePhoto(index)}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      <Shield className="w-4 h-4 inline mr-1" />
                      Photos help build trust with clients. Use clear, recent photos that show your face.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Step 4: Pricing & Verification */}
            {currentStep === 4 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <DollarSign className="w-5 h-5 mr-2" />
                    Pricing & Final Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="ratePerMinute"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Rate per Minute (₹)</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            min="10" 
                            max="100"
                            {...field} 
                            data-testid="input-rate"
                          />
                        </FormControl>
                        <FormDescription>
                          Set your rate between ₹10-₹100 per minute. You'll receive 75% of this amount.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                    <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                      What happens next?
                    </h4>
                    <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                      <li>• Your profile will be reviewed within 24 hours</li>
                      <li>• You'll be notified once verification is complete</li>
                      <li>• After approval, you can start accepting calls</li>
                      <li>• Government ID verification may be required</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Navigation Buttons */}
            <div className="flex justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={prevStep}
                disabled={currentStep === 1}
                data-testid="button-prev-step"
              >
                Previous
              </Button>

              {currentStep < 4 ? (
                <Button
                  type="button"
                  onClick={nextStep}
                  data-testid="button-next-step"
                >
                  Next
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={createProfileMutation.isPending || uploadedPhotos.length === 0}
                  data-testid="button-submit-profile"
                >
                  {createProfileMutation.isPending ? (
                    <>
                      <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />
                      Creating Profile...
                    </>
                  ) : (
                    'Create Profile'
                  )}
                </Button>
              )}
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
